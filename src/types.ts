import { createSdk } from 'invest-nodejs-grpc-sdk';

export type InvestSdk = ReturnType<typeof createSdk>;