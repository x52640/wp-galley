/**
 * 統一錯誤格式。所有 API 錯誤都長這樣：
 * { "error": { "code", "message", "details"?, "requestId" } }
 *
 * 原則：訊息對使用者要有用，但不得包含堆疊、內部路徑或秘密。
 */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class AppError extends Error {
  override readonly name = 'AppError';
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const errorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  NON_LOCAL_HOST: 'NON_LOCAL_HOST',
  NON_LOCAL_CLIENT: 'NON_LOCAL_CLIENT',
  CROSS_ORIGIN_BLOCKED: 'CROSS_ORIGIN_BLOCKED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TEMPLATE_VALIDATION_FAILED: 'TEMPLATE_VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // 階段 5：CoreService 的錯誤。code 與 core/errors.ts 的 coreErrorCodes 一致，
  // 讓 UI 與日後的 MCP client 都靠同一組字串分辨，不必去比對訊息文字。
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  APPROVAL_FORBIDDEN: 'APPROVAL_FORBIDDEN',
  CONTENT_CHANGED: 'CONTENT_CHANGED',
  CONTENT_INVALID: 'CONTENT_INVALID',
  PUBLISH_BLOCKED: 'PUBLISH_BLOCKED',
  MEDIA_ERROR: 'MEDIA_ERROR',
  AGENT_ERROR: 'AGENT_ERROR',
  WORDPRESS_UNAVAILABLE: 'WORDPRESS_UNAVAILABLE',
  WORDPRESS_ERROR: 'WORDPRESS_ERROR',
  REMOTE_CHANGED: 'REMOTE_CHANGED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export function toErrorBody(
  error: unknown,
  requestId: string,
): { statusCode: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      },
    };
  }

  // 未預期的錯誤：對外只給通用訊息，細節留在 server log。
  return {
    statusCode: 500,
    body: {
      error: {
        code: errorCodes.INTERNAL_ERROR,
        message: '發生內部錯誤，請查看終端機的 server log。',
        requestId,
      },
    },
  };
}
