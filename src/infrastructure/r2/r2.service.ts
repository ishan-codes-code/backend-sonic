import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

@Injectable()
export class R2Service {
  private readonly s3: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.get<string>('r2.bucket')!;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${this.configService.get<string>('r2.accountId')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.configService.get<string>('r2.accessKey')!,
        secretAccessKey: this.configService.get<string>('r2.secretKey')!,
      },
    });
  }

  async uploadStream(stream: Readable, filename: string) {
    const key = `songs/${filename}`;

    try {
      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: stream,
          ContentType: 'audio/mpeg',
        },
      });

      await upload.done();
      return key;
    } catch (err) {
      console.error('R2 upload failed:', err);
      stream.destroy();
      throw new Error('R2 upload failed');
    }
  }

  async getSignedUrl(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return getSignedUrl(this.s3, command, { expiresIn: 300 });
    } catch (err) {
      console.error('Signed URL generation failed:', err);
      throw new Error('Failed to generate signed URL');
    }
  }
}
