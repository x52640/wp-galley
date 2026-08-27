import { describe, expect, it } from 'vitest';
import { AgentRegistry, AgentUnavailableError } from '../src/agents/registry.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import type { AgentRequest } from '../src/agents/types.js';

const request: AgentRequest = {
  systemPrompt: '規則',
  userPrompt: '原稿',
  workspaceDir: '/tmp/ws',
  timeoutMs: 5000,
  maxOutputBytes: 1024,
};

const schema = { type: 'object' };

describe('偵測', () => {
  it('列出全部 Agent 的狀態', async () => {
    const registry = new AgentRegistry({
      adapters: [new FakeAdapter('codex', 'Codex'), new FakeAdapter('claude', 'Claude')],
    });
    const all = await registry.detectAll();
    expect(all.map((s) => s.id)).toEqual(['codex', 'claude']);
    expect(all.every((s) => s.available)).toBe(true);
  });

  it('偵測結果有快取，不會每次都跑子行程', async () => {
    const fake = new FakeAdapter('codex', 'Codex');
    const registry = new AgentRegistry({ adapters: [fake], now: () => 1000 });
    await registry.detect('codex');
    await registry.detect('codex');
    await registry.detect('codex');
    expect(fake.detectCount).toBe(1);
  });

  it('refresh 會略過快取', async () => {
    const fake = new FakeAdapter('codex', 'Codex');
    const registry = new AgentRegistry({ adapters: [fake], now: () => 1000 });
    await registry.detect('codex');
    await registry.detect('codex', { refresh: true });
    expect(fake.detectCount).toBe(2);
  });

  it('快取過期後重新偵測', async () => {
    const fake = new FakeAdapter('codex', 'Codex');
    let clock = 1000;
    const registry = new AgentRegistry({ adapters: [fake], now: () => clock });
    await registry.detect('codex');
    clock += 60_000;
    await registry.detect('codex');
    expect(fake.detectCount).toBe(2);
  });

  it('單一 adapter 偵測失敗會優雅降級，不影響其他家', async () => {
    const registry = new AgentRegistry({
      adapters: [
        new FakeAdapter('codex', 'Codex', { detectThrows: true }),
        new FakeAdapter('claude', 'Claude'),
      ],
    });
    const all = await registry.detectAll();
    const codex = all.find((s) => s.id === 'codex')!;
    expect(codex.available).toBe(false);
    expect(codex.loginState).toBe('unknown');
    expect(codex.unavailableReason).toContain('偵測失敗');
    expect(all.find((s) => s.id === 'claude')!.available).toBe(true);
  });

  it('未登入的 Agent 標為不可用並給出原因', async () => {
    const registry = new AgentRegistry({
      adapters: [
        new FakeAdapter('codex', 'Codex', {
          status: { loginState: 'logged-out', available: false, unavailableReason: '尚未登入' },
        }),
      ],
    });
    const [status] = await registry.detectAll();
    expect(status!.available).toBe(false);
    expect(status!.unavailableReason).toBe('尚未登入');
  });
});

describe('執行', () => {
  it('成功時回傳結構化資料', async () => {
    const registry = new AgentRegistry({ adapters: [new FakeAdapter('codex', 'Codex')] });
    const result = await registry.runStructured('codex', request, schema, 'run-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ title: '假結果' });
  });

  it('Agent 不可用時直接拒絕，不啟動子行程', async () => {
    const fake = new FakeAdapter('codex', 'Codex', {
      status: { available: false, unavailableReason: '尚未登入' },
    });
    const registry = new AgentRegistry({ adapters: [fake] });
    await expect(registry.runStructured('codex', request, schema, 'run-1')).rejects.toThrow(
      AgentUnavailableError,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it('未知的 Agent id 會被擋下', async () => {
    const registry = new AgentRegistry({ adapters: [new FakeAdapter('codex', 'Codex')] });
    await expect(registry.runStructured('claude', request, schema, 'run-1')).rejects.toThrow(
      AgentUnavailableError,
    );
  });

  it('同一時間只跑一個（concurrency 1）', async () => {
    const fake = new FakeAdapter('codex', 'Codex', { delayMs: 50 });
    const registry = new AgentRegistry({ adapters: [fake] });

    const order: string[] = [];
    await Promise.all([
      registry.runStructured('codex', request, schema, 'a').then(() => order.push('a')),
      registry.runStructured('codex', request, schema, 'b').then(() => order.push('b')),
      registry.runStructured('codex', request, schema, 'c').then(() => order.push('c')),
    ]);

    expect(order).toEqual(['a', 'b', 'c']);
    expect(fake.calls.map((c) => c.runId)).toEqual(['a', 'b', 'c']);
  });

  it('某次執行失敗不會卡死佇列', async () => {
    const failing = new FakeAdapter('codex', 'Codex', {
      result: {
        ok: false,
        reason: 'schema-mismatch',
        message: '壞掉',
        issues: [],
        meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
      },
    });
    const registry = new AgentRegistry({ adapters: [failing] });
    const first = await registry.runStructured('codex', request, schema, 'a');
    const second = await registry.runStructured('codex', request, schema, 'b');
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(failing.calls).toHaveLength(2);
  });

  it('失敗結果不會被當成資料回傳——不污染草稿', async () => {
    const failing = new FakeAdapter('codex', 'Codex', {
      result: {
        ok: false,
        reason: 'invalid-json',
        message: '不是 JSON',
        issues: ['x'],
        meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
      },
    });
    const registry = new AgentRegistry({ adapters: [failing] });
    const result = await registry.runStructured('codex', request, schema, 'a');
    expect(result.ok).toBe(false);
    expect('data' in result).toBe(false);
  });

  it('取消會轉給對應的 adapter', async () => {
    const fake = new FakeAdapter('codex', 'Codex');
    const registry = new AgentRegistry({ adapters: [fake] });
    await registry.cancel('codex', 'run-9');
    expect(fake.cancelled).toEqual(['run-9']);
  });
});
