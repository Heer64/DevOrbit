import mongoose from 'mongoose';

/*
 * [Sprint 4 · M4] US-34: one record per signed GitHub webhook delivery, for troubleshooting and
 * idempotency. deliveryId is GitHub's X-GitHub-Delivery header and is unique, so a delivery that
 * arrives twice is processed once. Only metadata is kept, never the payload or any header value
 * other than the event name and delivery ID. Records expire after 30 days.
 *
 * status:
 *   received   signature checked, saved, waiting to be processed
 *   processed  feed entries added (entries = how many; 0 when all were already in the feed)
 *   ignored    nothing to add: event or action not shown in the feed, or no project has this
 *              repository connected and Active (e.g. after a disconnect, US-33)
 *   failed     processing failed after all retries (NFR-11a); lastError says why
 */
export const DELIVERY_STATUSES = ['received', 'processed', 'ignored', 'failed'];
export const DELIVERY_TTL_SECONDS = 30 * 24 * 60 * 60;

const webhookDeliverySchema = new mongoose.Schema(
  {
    deliveryId: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    event: { type: String, required: true, trim: true, maxlength: 50 },
    action: { type: String, trim: true, maxlength: 40, default: '' },
    repositoryId: { type: Number, default: null },
    repoFullName: { type: String, trim: true, maxlength: 200, default: '' },
    projects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    status: { type: String, enum: DELIVERY_STATUSES, default: 'received' },
    attempts: { type: Number, default: 0, min: 0 },
    entries: { type: Number, default: 0, min: 0 },
    reason: { type: String, trim: true, maxlength: 200, default: '' },
    lastError: { type: String, trim: true, maxlength: 200, default: '' },
    receivedAt: { type: Date, required: true, default: Date.now },
    processedAt: { type: Date, default: null },
  },
  { versionKey: false }
);

webhookDeliverySchema.index({ receivedAt: 1 }, { expireAfterSeconds: DELIVERY_TTL_SECONDS });
webhookDeliverySchema.index({ repositoryId: 1, receivedAt: -1 });
webhookDeliverySchema.index({ projects: 1, receivedAt: -1 });

export default mongoose.model('WebhookDelivery', webhookDeliverySchema);
