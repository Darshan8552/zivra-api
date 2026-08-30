import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { CLOUDINARY } from './cloudinary.provider';
import type {
  UploadApiErrorResponse,
  UploadApiResponse,
  v2 as Cloudinary,
} from 'cloudinary';
import * as fs from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  CloudinaryAssetRef,
  CloudinaryResourceType,
  CloudinaryUploadResult,
} from '../common/types/cloudinary.types';

const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

@Injectable()
export class CloudinaryService {
  constructor(
    @Inject(CLOUDINARY) private readonly cloudinary: typeof Cloudinary,
  ) {}

  async uploadBuffer(
    file: Express.Multer.File,
    folder: string,
  ): Promise<CloudinaryUploadResult> {
    const resourceType = this.resolveResourceType(file.mimetype);

    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const uploadStream = this.cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: resourceType,
          },
          (
            error: UploadApiErrorResponse | undefined,
            uploadResult?: UploadApiResponse,
          ) => {
            if (error || !uploadResult) {
              reject(this.toUploadException(error));
              return;
            }
            resolve(uploadResult);
          },
        );

        let source: Readable;
        if (file.path) {
          source = fs.createReadStream(file.path);
          source.on('error', (err) => reject(err));
        } else if (file.buffer) {
          source = Readable.from(file.buffer);
        } else {
          reject(
            new BadRequestException('Invalid file: missing buffer and path'),
          );
          return;
        }

        source.pipe(uploadStream);
      });
    } finally {
      if (file.path) {
        await unlink(file.path).catch(() => {});
      }
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType,
      width: result.width,
      height: result.height,
      duration: result.duration as number | undefined,
      format: result.format,
    };
  }

  async uploadMany(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<CloudinaryUploadResult[]> {
    return Promise.all(files.map((file) => this.uploadBuffer(file, folder)));
  }

  async deleteAsset(
    publicId: string,
    resourceType: CloudinaryResourceType = 'image',
  ): Promise<void> {
    try {
      await this.cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
    } catch {}
  }

  async deleteMany(assets: CloudinaryAssetRef[]): Promise<void> {
    await Promise.all(
      assets.map((asset) =>
        this.deleteAsset(asset.publicId, asset.resourceType),
      ),
    );
  }

  private resolveResourceType(mimetype: string) {
    if (ALLOWED_IMAGE_MIME_TYPES.includes(mimetype)) return 'image';
    if (ALLOWED_VIDEO_MIME_TYPES.includes(mimetype)) return 'video';
    throw new BadRequestException(`Unsupported file type: ${mimetype}`);
  }

  private toUploadException(error: UploadApiErrorResponse | undefined) {
    const statusCode = error?.http_code ?? error?.statusCode;
    const detail = error?.message ?? error?.error ?? 'Cloudinary upload failed';

    if (
      statusCode === 401 ||
      statusCode === 403 ||
      /401|403|unauthorized|forbidden|invalid api|invalid signature/i.test(
        detail,
      )
    ) {
      return new InternalServerErrorException(
        'Cloudinary upload failed. Verify CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are correct and that the Cloudinary account is authorized for uploads.',
      );
    }

    return new InternalServerErrorException(
      `Cloudinary upload failed: ${detail}`,
    );
  }
}
