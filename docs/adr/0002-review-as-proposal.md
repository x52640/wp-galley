# ADR-0002：校稿結果存成提案，不直接產生版本

- 日期：2026-08-28
- 狀態：已採納（決策 D-007）
- 影響：[review-proposals.md](../specs/review-proposals.md)、[core-service.md](../specs/core-service.md)

## 背景

原本 `runAgentReview` 一拿到結果就 `createRevision`，Agent 的改動整份落地。

## 問題

整份落地代表 Agent 改了九個地方、八個對、一個把原意改掉了，使用者只能全收或全退。
原始計畫要的是「逐項接受、拒絕或全部接受」，而 `meaningChanged` 為真的項目
**預設不套用**——直接落地就違反了這一條。

## 決定

Agent 的輸出存成提案（`review_proposals` / `review_items`），內容一個字都不動，
使用者逐項決定。連帶結果：校稿本身不再讓核准失效，套用某一項時才失效。

## 取捨

逐項套用只能靠字串定位，定位不到的項目標成「要自己改」，而不是猜一個位置替換——
猜錯的話使用者不會知道文章被改到哪裡。機制見 review-proposals.md。
