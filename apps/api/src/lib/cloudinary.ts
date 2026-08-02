import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { getEnv } from '@event-ticketing/config';
import { AppError } from './errors.ts';
import { logger } from './logger.ts';

const env = getEnv();

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export type DetectedFileType = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'mp4' | 'webm';

/** §8 upload limits. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_KYC_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_EVENT_IMAGES = 3;

export const IMAGE_TYPES: DetectedFileType[] = ['png', 'jpeg', 'gif', 'webp'];
export const VIDEO_TYPES: DetectedFileType[] = ['mp4', 'webm'];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/**
 * Identifies a file by its content (§8: "verify magic bytes, not extension").
 * An extension is attacker-controlled metadata; the first bytes are the file.
 * Returns null for anything unrecognised — including a renamed executable.
 */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (startsWith(bytes, ascii('%PDF-'))) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(bytes, ascii('ftyp'), 4)) return 'mp4';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  return null;
}

/**
 * Reads the file, checks its size, and verifies the real type is one the
 * caller accepts. Throws before any byte reaches Cloudinary.
 */
export async function readAndValidate(
  file: File,
  allowed: DetectedFileType[],
  maxBytes: number,
  field: string,
): Promise<{ bytes: Uint8Array; type: DetectedFileType }> {
  if (file.size > maxBytes) {
    throw new AppError('VALIDATION_FAILED', {
      message: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit.`,
      field,
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFileType(bytes);

  if (!type || !allowed.includes(type)) {
    // Deliberately does not echo the detected type: a probing uploader learns
    // only that the file was refused.
    throw new AppError('VALIDATION_FAILED', {
      message: `Unsupported file content. Expected one of: ${allowed.join(', ')}.`,
      field,
      detail: { declaredName: file.name, detected: type },
    });
  }

  return { bytes, type };
}

export type UploadResult = {
  url: string;
  publicId: string;
  /** Cloudinary moderation verdict, when moderation was requested (§8). */
  moderationStatus: string | null;
};

/**
 * Uploads to Cloudinary. Any failure surfaces as UPSTREAM_UNAVAILABLE so the
 * caller can retry the media step alone rather than losing the whole event
 * (F13) — event creation never depends on this call succeeding.
 */
export async function uploadBuffer(input: {
  bytes: Uint8Array;
  folder: string;
  resourceType: 'image' | 'video' | 'raw';
  moderate?: boolean;
}): Promise<UploadResult> {
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: input.folder,
        resource_type: input.resourceType,
        ...(input.moderate ? { moderation: 'manual' } : {}),
      },
      (error, response) => {
        if (error || !response) reject(error ?? new Error('empty cloudinary response'));
        else resolve(response);
      },
    );
    stream.end(Buffer.from(input.bytes));
  }).catch((err: unknown) => {
    logger.error({ err: (err as Error)?.message }, 'cloudinary upload failed');
    throw new AppError('UPSTREAM_UNAVAILABLE', {
      message: 'Media upload is temporarily unavailable. Please retry.',
      cause: err,
    });
  });

  const moderation = result.moderation as Array<{ status?: string }> | undefined;

  return {
    url: result.secure_url,
    publicId: result.public_id,
    moderationStatus: moderation?.[0]?.status ?? null,
  };
}
