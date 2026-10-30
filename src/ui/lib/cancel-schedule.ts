/** 取消的原始錯誤優先；成功時才單獨回報重讀錯誤。 */
export async function cancelThenRefresh(cancel: () => Promise<void>, refresh: () => Promise<void>): Promise<void> {
  try {
    await cancel();
  } catch (error) {
    try { await refresh(); } catch { /* 重讀不能蓋掉取消的原因。 */ }
    throw error;
  }
  await refresh();
}
