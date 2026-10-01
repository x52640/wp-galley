/**
 * 位址檢查（security.md「取回器」的「位址」）：解析出來的位址是不是本機、內網或保留位址。
 * 用 Node 內建 `net.BlockList`；IPv6 裡內含 IPv4 的形式（IPv4 映射、NAT64、6to4）取出 IPv4 再查一次。
 */
import { BlockList, isIP } from 'node:net';

const blockList = new BlockList();

// security.md 列的最低要求，加上文件用、相容性的保留段（多擋不會擋到正常網站）。
const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['::', 128], // 未指定
  ['::1', 128], // loopback
  ['64:ff9b:1::', 48], // NAT64 本地轉譯前綴（RFC 8215），整段拒絕
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo：內含混淆過的 IPv4
  ['2001:db8::', 32], // 文件用
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

for (const [net, prefix] of IPV4_BLOCKED) blockList.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of IPV6_BLOCKED) blockList.addSubnet(net, prefix, 'ipv6');

/** 把 IPv6 字串展開成 8 個 16-bit 數字；不合法回 null。允許結尾是點分 IPv4。 */
export function expandIPv6(input: string): number[] | null {
  let ip = input.split('%')[0] ?? '';
  if (isIP(ip) !== 6) return null;
  const lastColon = ip.lastIndexOf(':');
  const lastPart = ip.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const v4 = lastPart.split('.').map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const toNums = (part: string | undefined) =>
    part ? part.split(':').map((x) => Number.parseInt(x, 16)) : [];
  const head = toNums(halves[0]);
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toNums(halves[1]);
  const zeros = 8 - head.length - rest.length;
  if (zeros < 0) return null;
  return [...head, ...new Array<number>(zeros).fill(0), ...rest];
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** IPv6 裡內含的 IPv4（映射、NAT64 /96、6to4、IPv4 相容）；沒有回 null。 */
export function embeddedIPv4(ip: string): string | null {
  const g = expandIPv6(ip);
  if (!g) return null;
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d
  if (allZero(0, 5) && g[5] === 0xffff) return v4FromGroups(g[6]!, g[7]!);
  // ::a.b.c.d（已廢棄的 IPv4 相容）
  if (allZero(0, 6)) return v4FromGroups(g[6]!, g[7]!);
  // 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return v4FromGroups(g[6]!, g[7]!);
  // 2002::/16（6to4）：第 16～48 bit
  if (g[0] === 0x2002) return v4FromGroups(g[1]!, g[2]!);
  return null;
}

/** 這個位址能不能連。不認得的格式一律當成不能連。 */
export function isBlockedAddress(address: string): boolean {
  const bare = address.split('%')[0] ?? '';
  const family = isIP(bare);
  if (family === 4) return blockList.check(bare, 'ipv4');
  if (family !== 6) return true;
  if (blockList.check(bare, 'ipv6')) return true;
  const v4 = embeddedIPv4(bare);
  return v4 !== null && blockList.check(v4, 'ipv4');
}
