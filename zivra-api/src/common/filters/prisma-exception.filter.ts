import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Request, Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.BAD_REQUEST;
    let message = 'Database error';
    let error = 'Bad Request';

    switch (exception.code) {
      case 'P2025':
        // An operation failed because it depends on one or more records that were required but not found
        // For cursor pagination, treat as invalid cursor
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid cursor';
        error = 'Bad Request';
        break;
      case 'P2002':
        status = HttpStatus.CONFLICT;
        message = 'Unique constraint violation';
        error = 'Conflict';
        break;
      case 'P2003':
      case 'P2023':
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid identifier';
        error = 'Bad Request';
        break;
      case 'P2016':
        status = HttpStatus.BAD_REQUEST;
        message = 'Query interpretation error';
        error = 'Bad Request';
        break;
      default:
        status = HttpStatus.BAD_REQUEST;
        message = 'Database request failed';
        error = 'Bad Request';
        break;
    }

    this.logger.warn(
      `Prisma ${exception.code} at ${request.method} ${request.originalUrl} — ${exception.message}`,
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}

@Catch(Prisma.PrismaClientValidationError)
export class PrismaValidationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaValidationExceptionFilter.name);

  catch(exception: Prisma.PrismaClientValidationError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.logger.warn(
      `Prisma validation error at ${request.method} ${request.originalUrl}`,
    );

    response.status(HttpStatus.BAD_REQUEST).json({
      success: false,
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Invalid query parameters',
      error: 'Bad Request',
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
