import type { Migration } from '../migrate.js';
import { migration001 } from './001-init.js';
import { migration002 } from './002-remote-snapshot.js';
import { migration003 } from './003-review-proposals.js';
import { migration004 } from './004-image-briefs.js';

/** 依序套用。新增 migration 就往陣列尾端加，不要改動已發布的項目。 */
export const migrations: readonly Migration[] = [migration001, migration002, migration003, migration004];
