import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { StorageProviderError } from "./storage-provider";

@Catch(StorageProviderError)
export class GoogleDriveExceptionFilter
  implements ExceptionFilter<StorageProviderError>
{
  catch(exception: StorageProviderError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = this.status(exception);
    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status],
      code: exception.code,
      message: exception.message,
    });
  }

  private status(exception: StorageProviderError): number {
    switch (exception.code) {
      case "STORAGE_AUTH_REQUIRED":
        return HttpStatus.CONFLICT;
      case "STORAGE_OWNER_MISMATCH":
        return HttpStatus.FORBIDDEN;
      case "STORAGE_FILE_TOO_LARGE":
        return HttpStatus.PAYLOAD_TOO_LARGE;
      case "STORAGE_CONFIGURATION_INVALID":
      case "STORAGE_PROVIDER_FAILURE":
        return HttpStatus.SERVICE_UNAVAILABLE;
      default:
        return HttpStatus.BAD_REQUEST;
    }
  }
}
