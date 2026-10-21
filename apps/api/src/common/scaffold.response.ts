import { HttpException, HttpStatus } from '@nestjs/common';

export interface ScaffoldList {
  items: unknown[];
  stub: true;
  module: string;
}

export function scaffoldList(moduleName: string): ScaffoldList {
  return {
    items: [],
    stub: true,
    module: moduleName,
  };
}

export function scaffoldNotReady(moduleName: string): never {
  throw new HttpException(
    {
      statusCode: HttpStatus.NOT_IMPLEMENTED,
      module: moduleName,
      message:
        'Scaffold placeholder. This route is in the Backend formal v0 contract and is not persisted yet.',
    },
    HttpStatus.NOT_IMPLEMENTED,
  );
}
