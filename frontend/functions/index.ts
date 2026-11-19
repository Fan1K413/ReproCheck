import { createDatabaseClient, createSiteContext, requireUser, errorResponse, BackendError } from './_qoder/backend.mjs';
import { createStorageClient } from './_qoder/storage.mjs';
import { application } from './routes.ts';

const handle = application({
  db: createDatabaseClient(),
  storage: createStorageClient(),
  requireUser,
  BackendError,
  secret: Deno.env.get('APP_JWT_SECRET') ?? '',
});
Deno.serve(async request => {
  let context;
  try { context = createSiteContext(request); return await handle(context); }
  catch (error) { return errorResponse(error, context?.requestId); }
});