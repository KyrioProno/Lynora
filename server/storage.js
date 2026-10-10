import { resolve } from 'node:path';

// Railway provides this only at runtime, after a persistent volume is attached.
// Refuse to start without one: silently storing accounts/photos on ephemeral disk
// would lose user data at the next deployment.
if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  throw new Error('Lynora requires a Railway Volume. Attach a volume to this service (mount path /data), then redeploy.');
}
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
export const dbPath = process.env.DB_PATH || (volume ? resolve(volume, 'lynora.sqlite') : 'data/lynora.sqlite');
export const uploadDir = resolve(process.env.UPLOAD_DIR || (volume ? resolve(volume, 'uploads') : 'public/uploads'));
