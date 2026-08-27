import type { Migration } from '../migrate.js';
import { migration001 } from './001-init.js';

/** 依序套用。新增 migration 就往陣列尾端加，不要改動已發布的項目。 */
export const migrations: readonly Migration[] = [migration001];
