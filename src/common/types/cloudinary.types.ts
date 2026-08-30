export type CloudinaryResourceType = 'image' | 'video';

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  resourceType: CloudinaryResourceType;
  width?: number;
  height?: number;
  duration?: number;
  format?: string;
}

export interface CloudinaryAssetRef {
  publicId: string;
  resourceType: CloudinaryResourceType;
}
