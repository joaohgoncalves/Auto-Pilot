import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function badRequest(message: string, details?: unknown) { return new ApiError(400, 'BAD_REQUEST', message, details); }
export function unauthorized(message = 'Unauthorized') { return new ApiError(401, 'UNAUTHORIZED', message); }
export function forbidden(message = 'Forbidden') { return new ApiError(403, 'FORBIDDEN', message); }
export function notFound(message = 'Not found') { return new ApiError(404, 'NOT_FOUND', message); }
export function conflict(message = 'Conflict') { return new ApiError(409, 'CONFLICT', message); }

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  const requestId = request.id;

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload or query parameters.',
        requestId,
        details: error.flatten()
      }
    });
  }

  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details ? { details: error.details } : {})
      }
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaCode = (error as Prisma.PrismaClientKnownRequestError).code;
    if (prismaCode === 'P2002') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Resource already exists.', requestId } });
    }
    if (prismaCode === 'P2025') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found.', requestId } });
    }
  }

  request.log.error({ err: error, requestId }, 'Unhandled API error');
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
      requestId
    }
  });
}
