#!/usr/bin/env bash
# Task 38 辅助：桌面宽度（1440）下打开表编辑对话框截图，供 VLM 视觉复核
set -u
ROOT=/home/z/my-project/dbm-work
SHOTS=$ROOT/docs/screenshots
cleanup() {
  if [ -n "${DEV_PID:-}" ]; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
  fi
}
trap cleanup EXIT
cd "$ROOT"
./node_modules/.bin/vp dev > /tmp/task38-dev.log 2>&1 &
DEV_PID=$!
PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE 'localhost:[0-9]+' /tmp/task38-dev.log | head -1 | cut -d: -f2)
  if [ -n "$PORT" ] && curl -s "http://localhost:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done
[ -z "$PORT" ] && { echo "FATAL: dev server 未就绪"; exit 1; }
export AGENT_BROWSER_SESSION="task38-shot-$$"
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open "http://localhost:$PORT" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1 || true
agent-browser eval "document.querySelector('.nav-btn[aria-label=\"模型编辑器\"]')?.click()" >/dev/null 2>&1
sleep 1
agent-browser eval "document.querySelector('.table-card')?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))" >/dev/null 2>&1
sleep 1.2
agent-browser screenshot "$SHOTS/task38-desktop-light.png" >/dev/null 2>&1
# 暗色主题再来一张
agent-browser eval "document.querySelector('.icon-btn[title*=\"切换为\"]')?.click()" >/dev/null 2>&1
sleep 0.8
agent-browser screenshot "$SHOTS/task38-desktop-dark.png" >/dev/null 2>&1
echo "done: $SHOTS/task38-desktop-light.png / task38-desktop-dark.png"
