#!/bin/bash
#
# 雙擊啟動發布台。
#
# 在 Finder 裡按兩下就會開一個終端機視窗跑服務，並自動打開瀏覽器。
# 那個終端機視窗**就是服務本體**，關掉視窗或按 Ctrl+C 就是關掉發布台。
#
# 用的是開發模式（npm run dev）：改了程式碼會自動重載，適合現在還在開發的階段。
# 之後專案穩定了想跑得更輕，改成 npm run build && npm start 即可。

set -e
cd "$(dirname "$0")/.."

echo "正在啟動本機 WordPress 發布台…"
echo "（這個視窗就是服務本體，關掉視窗就等於關掉發布台）"
echo

# 等 Vite 真的起來再開瀏覽器，不然會看到「無法連線」。
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null http://127.0.0.1:5173/; then
      open "http://127.0.0.1:5173"
      exit 0
    fi
    sleep 0.5
  done
  echo "等了 30 秒服務還沒起來，請看上面的錯誤訊息。"
) &

exec npm run dev
