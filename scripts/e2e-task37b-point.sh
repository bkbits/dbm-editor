#!/usr/bin/env bash
# Task 37 补充验证：elementFromPoint DOM 采样——内容滚过固定列下方时，
# 固定列区域内的采样点必须命中固定列元素（遮挡的 DOM 级硬证明）
set -u
ROOT=/home/z/my-project/dbm-work
cd "$ROOT"

./node_modules/.bin/vp dev > /tmp/task37b-dev.log 2>&1 &
DEV_PID=$!
# kill 父进程之外补杀 vite 子进程，避免孤儿 dev server 占端口污染后续运行
cleanup() {
  if [ -n "${DEV_PID:-}" ]; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task37b-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
[ -z "$PORT" ] && { echo "FATAL: dev server 未就绪"; tail -20 /tmp/task37b-dev.log; exit 1; }
echo "== dev server: http://localhost:$PORT =="

export AGENT_BROWSER_SESSION="task37b-verify"
agent-browser set viewport 760 900 >/dev/null 2>&1
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true

agent-browser eval "document.querySelector('.nav-btn[aria-label=\"模型编辑器\"]')?.click()" >/dev/null 2>&1
sleep 1
agent-browser eval "document.querySelector('.table-card').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
sleep 1.5

# 采样表达式：scrollLeft 设为 max-40（最后一列正处删除 pin 下方）与 max/3（内容处 name pin 下方），
# 对每行采样：删除位三点（left+3/中/right-3）、缝隙点（grid.left+30）、name pin 内点（grid.left+40），
# elementFromPoint 命中元素必须属于固定列（cell-pin 或其后代），统计命中的非固定列元素。
SAMPLE='(function(){
  var g=document.querySelector(".grid-scroll");
  var gl=g.getBoundingClientRect().left;
  var rows=[...document.querySelectorAll(".columns-body .column-row")];
  var bad=[], total=0;
  rows.forEach(function(r,i){
    var pin=r.querySelector(".cell-pin-del");
    var pr=pin.getBoundingClientRect();
    var cy=pr.top+pr.height/2;
    var pts=[[pr.left+3,cy],[pr.left+13,cy],[pr.right-3,cy],[gl+30,pr.top+pr.height/2],[gl+40,pr.top+pr.height/2]];
    pts.forEach(function(p){
      total++;
      var el=document.elementFromPoint(p[0],p[1]);
      if(!el)return;
      if(!el.closest(".cell-pin")) bad.push("r"+i+"@"+Math.round(p[0])+":"+el.tagName+"."+(el.className&&el.className.baseVal!==undefined?"svg":String(el.className).slice(0,30)));
    });
  });
  return JSON.stringify({total:total,bad:bad.slice(0,8)});
})()'

for OFFS in "max40" "third"; do
  if [ "$OFFS" = "max40" ]; then
    agent-browser eval "var g=document.querySelector('.grid-scroll');g.scrollLeft=g.scrollWidth-g.clientWidth-40;'ok'" >/dev/null 2>&1
  else
    agent-browser eval "var g=document.querySelector('.grid-scroll');g.scrollLeft=Math.floor((g.scrollWidth-g.clientWidth)/3);'ok'" >/dev/null 2>&1
  fi
  sleep 0.6
  echo "== scrollOffset=$OFFS =="
  agent-browser eval "$SAMPLE" 2>/dev/null
  echo ""
done
