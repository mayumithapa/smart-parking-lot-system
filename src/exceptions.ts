/**
 * Domain exceptions, mapped to HTTP status codes by the error handler.
 */

export class ParkingError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

export class NoSpotAvailable extends ParkingError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class VehicleAlreadyParked extends ParkingError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class TicketNotFound extends ParkingError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class TicketAlreadyClosed extends ParkingError {
  constructor(message: string) {
    super(message, 409);
  }
}
