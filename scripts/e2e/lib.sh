#!/usr/bin/env bash
# e2e/lib.sh —— E2E 套件公共设施（各测试脚本 source 本文件）
#
# 职责：
# - ROOT 由脚本位置动态推导（兼容 MSYS 与 Linux）
# - dev server：先探活复用已有实例，否则自起并在退出时回收（补杀 vite 子进程）
# - mock SSE：start_mock / stop_mock（浏览器直连跨域端口，mock 自带 CORS *）
# - agent-browser 会话隔离 + 常用断言（check / check_num / ev / poll）
# - 高频交互 helper：nav / header_nav / fit_all / click_modal_text / reset_demo /
#   open_canvas_menu / dbl_card / dbl_edge / ask / theme_toggle
#
# 排障约定（沿用历史脚本沉淀）：
# - antdv 弹层关闭后 DOM 保留 → modal 判定一律用可见性（offsetParent / display）
# - antdv 双字按钮渲染插入空格 → 按钮文本匹配去空白（click_modal_text）
# - autoLayout() 末尾自带 fitAll()（视口变化不进历史）→ 位置断言比较 localStorage
#   world 坐标快照而非屏幕坐标
# - 「Ctrl+Z 撤销隐藏表」非历史行为（乐观更新 + 失败回滚），不作为断言对象
# - usage 分片先于 [DONE] 到达 → 完成态判定 poll 消息失去 streaming 类
# - 程序化改 scrollTop 后须同步 dispatchEvent(scroll) 模拟用户滚动（事件异步派发）
# 已知环境坑：沙箱可能回收派生进程 → 单脚本内完成「起服务 → 断言 → 收尾」。

# ---------- 基础环境 ----------
E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && { pwd -W 2>/dev/null || pwd; })"
ROOT="$(cd "$E2E_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"
PORT="${PORT:-3000}"
BASE_URL="http://localhost:$PORT"
MOCK_PORT="${MOCK_PORT:-4841}"
MOCK_URL="http://localhost:$MOCK_PORT/v1"
SHOTS="$ROOT/docs/screenshots"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-e2e-$$}"

cd "$ROOT" || exit 1
mkdir -p "$SHOTS" "$ROOT/tmp"

PASS=0; FAIL=0; FAILED=()
DEV_PID=""
MOCK_PID=""

# ---------- 断言 ----------

# 布尔断言：expr 求值为 true 才 PASS
check() {
  local name="$1" expr="$2" out
  out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
  if [ "$out" = "true" ]; then
    PASS=$((PASS+1)); echo "  PASS  $name"
  else
    FAIL=$((FAIL+1)); FAILED+=("$name"); echo "  FAIL  $name  =>  $out"
  fi
}

# 数值断言：expr 求值与期望字符串严格相等
check_num() {
  local name="$1" expr="$2" want="$3" out
  out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
  if [ "$out" = "$want" ]; then
    PASS=$((PASS+1)); echo "  PASS  $name"
  else
    FAIL=$((FAIL+1)); FAILED+=("$name"); echo "  FAIL  $name  =>  $out (期望 $want)"
  fi
}

# bash 层字符串断言（本地值比较）
check_eq() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); echo "  PASS  $name"
  else
    FAIL=$((FAIL+1)); FAILED+=("$name"); echo "  FAIL  $name  =>  $got (期望 $want)"
  fi
}

# eval 求值取原始输出
ev() { agent-browser eval "$1" 2>/dev/null | tr -d '"'; }

# 轮询等待 expr 为 true（默认 10s，0.5s 间隔）
poll() {
  local expr="$1" t="${2:-10}" i=0 out
  while [ $i -lt $((t * 2)) ]; do
    out=$(agent-browser eval "$expr" 2>/dev/null | tr -d '"')
    [ "$out" = "true" ] && return 0
    sleep 0.5; i=$((i+1))
  done
  return 1
}

# ---------- dev server / mock 生命周期 ----------

ensure_dev_server() {
  if ! curl -s -o /dev/null -m 3 "$BASE_URL/"; then
    echo "== 未检测到 $BASE_URL，自行启动 dev server =="
    ./node_modules/.bin/vp dev > "$ROOT/tmp/e2e-dev.log" 2>&1 &
    DEV_PID=$!
    for _ in $(seq 1 40); do
      curl -s -o /dev/null -m 2 "$BASE_URL/" && break
      sleep 1
    done
  fi
  if ! curl -s -o /dev/null -m 3 "$BASE_URL/"; then
    echo "FATAL: dev server 未就绪（$BASE_URL）"
    [ -n "$DEV_PID" ] && tail -20 "$ROOT/tmp/e2e-dev.log"
    exit 1
  fi
}

start_mock() {
  node "$E2E_DIR/mock/ai-mock.mjs" "$MOCK_PORT" > "$ROOT/tmp/e2e-mock.log" 2>&1 &
  MOCK_PID=$!
  sleep 2
  if ! kill -0 "$MOCK_PID" 2>/dev/null; then
    echo "FATAL: mock 启动失败（端口 $MOCK_PORT 可能被占用）"
    tail -10 "$ROOT/tmp/e2e-mock.log"
    exit 1
  fi
}

stop_mock() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  MOCK_PID=""
}

# mock 日志 grep（$1=模式；静默返回）
mock_has() { grep -q "$1" "$ROOT/tmp/e2e-mock.log" 2>/dev/null; }
mock_count() { grep -c "$1" "$ROOT/tmp/e2e-mock.log" 2>/dev/null; }

cleanup() {
  stop_mock
  if [ -n "$DEV_PID" ]; then
    pkill -P "$DEV_PID" 2>/dev/null  # 补杀 vite 子进程，防孤儿占端口
    kill "$DEV_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

# ---------- 高频交互 helper ----------

# 侧栏导航（页面级）
nav() { agent-browser eval "document.querySelector('.nav-btn[aria-label=\"$1\"]')?.click()" >/dev/null 2>&1; sleep 0.6; }

# 视口适配全部卡片（画布工具栏「适应画布」按钮）
fit_all() {
  agent-browser eval "(function(){var b=[...document.querySelectorAll('.canvas-toolbar button')].find(function(x){return x.querySelector('svg.lucide-maximize-2')});if(b){b.click();return 'ok'}return 'nf'})()" >/dev/null 2>&1
  sleep 1
}

# 点击弹层/菜单中文本按钮（antdv 中文双字按钮渲染插入空格 → 去空白匹配；只在可见弹层内查找；
# 同时覆盖 ant-popconfirm（popover 弹层，删除确认等非 modal 场景））
click_modal_text() {
  agent-browser eval "(function(){var ws=[...document.querySelectorAll('.ant-modal-wrap, .ant-modal-confirm, .ant-popover')].filter(function(w){return getComputedStyle(w).display!=='none'});for(var i=0;i<ws.length;i++){var b=[...ws[i].querySelectorAll('button')].find(function(x){return x.textContent.replace(/\\s+/g,'')==='$1'});if(b){b.click();return 'ok'}}var c=document.querySelector('.ctx-menu');if(c){var cb=[...c.querySelectorAll('button')].find(function(x){return x.textContent.replace(/\\s+/g,'')==='$1'});if(cb){cb.click();return 'ctx-ok'}}return 'nf'})()" >/dev/null 2>&1
}

# 仅在 ant-modal-confirm（Modal.confirm 二次确认弹窗）内点击中文本按钮
# （与 click_modal_text 的区别：不搜 popconfirm——两段确认链路中 popconfirm 与
#  Modal.confirm 可能同时可见，需精确命中后者）
click_confirm_text() {
  agent-browser eval "(function(){var ws=[...document.querySelectorAll('.ant-modal-confirm')].filter(function(w){return getComputedStyle(w).display!=='none'});for(var i=0;i<ws.length;i++){var b=[...ws[i].querySelectorAll('button')].find(function(x){return x.textContent.replace(/\\s+/g,'')==='$1'});if(b){b.click();return 'ok'}}return 'nf'})()" >/dev/null 2>&1
}

# 重置演示数据（大纲面板按钮[1] → 确认「重置」→ 等 10 卡片）
reset_demo() {
  agent-browser eval "document.querySelectorAll('.outline-actions button')[1]?.click()" >/dev/null 2>&1
  sleep 1
  click_modal_text "重置"
  poll "document.querySelectorAll('.table-card').length === 10" 15
  sleep 0.5
}

# 画布空白处右键菜单
open_canvas_menu() {
  agent-browser press Escape >/dev/null 2>&1
  sleep 0.3
  agent-browser mouse move 700 450 >/dev/null 2>&1
  agent-browser mouse down right >/dev/null 2>&1
  agent-browser mouse up right >/dev/null 2>&1
  sleep 0.8
}

dbl_card() {
  agent-browser eval "(function(){var c=document.querySelector('.table-card');if(!c)return 'nf';c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return 'ok'})()" >/dev/null 2>&1
  sleep 1
}

dbl_edge() {
  agent-browser eval "(function(){var e=document.querySelector('.edge-hit');if(!e)return 'nf';e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return 'ok'})()" >/dev/null 2>&1
  sleep 1
}

# AI 发送消息（填输入框 + 点发送）
ask() {
  agent-browser find first ".input-box textarea" fill "$1" >/dev/null 2>&1
  sleep 0.4
  agent-browser click ".send-btn" >/dev/null 2>&1
}

# 等待 AI 本轮结束（发送按钮从停止态恢复）
wait_ai_done() {
  poll "!document.querySelector('.send-btn.stop')" "${1:-30}"
}

# 主题切换（顶栏图标按钮）
theme_toggle() {
  agent-browser eval "[...document.querySelectorAll('.header-right .icon-btn')].find(b=>b.title&&b.title.includes('主题'))?.click()" >/dev/null 2>&1
  sleep 1
}

# ---------- 页面与错误基线 ----------

# 打开首页并清理错误/控制台基线
open_app() {
  agent-browser open "$BASE_URL" >/dev/null 2>&1
  sleep 3
  agent-browser errors --clear >/dev/null 2>&1
  agent-browser console --clear >/dev/null 2>&1
}

# 收尾：页面错误 / 控制台 ERROR 双零检查 + 汇总打印 + 退出码
finish_suite() {
  local label="${1:-E2E}"
  ERRS=$(agent-browser errors 2>/dev/null | grep -v "^$" | wc -l)
  if [ "$ERRS" = "0" ]; then
    PASS=$((PASS+1)); echo "  PASS  全程页面错误 0 条"
  else
    FAIL=$((FAIL+1)); FAILED+=("页面错误"); echo "  FAIL  页面错误 $ERRS 条"; agent-browser errors 2>/dev/null | tail -5
  fi
  # 预期错误过滤：脚本可设 EXPECTED_ERR_RE（扩展正则）排除按设计产生的
  # error 级日志（如 api 日志器对业务拒绝 / 中止的记录）
  DBG_ERR=$(agent-browser console 2>/dev/null | grep "\[ERROR\]" | grep -Ev "${EXPECTED_ERR_RE:-\$^}" | wc -l)
  if [ "$DBG_ERR" = "0" ]; then
    PASS=$((PASS+1)); echo "  PASS  控制台 ERROR 日志 0 条"
  else
    FAIL=$((FAIL+1)); FAILED+=("控制台 ERROR"); echo "  FAIL  控制台 ERROR $DBG_ERR 条"; agent-browser console 2>/dev/null | grep "\[ERROR\]" | tail -5
  fi
  echo ""
  echo "=============================================="
  echo "[$label] PASS: $PASS  FAIL: $FAIL"
  if [ ${#FAILED[@]} -gt 0 ]; then echo "失败项: ${FAILED[*]}"; fi
  echo "=============================================="
  agent-browser close >/dev/null 2>&1
  [ "$FAIL" -eq 0 ] && echo "ALL_GREEN" || exit 1
}
