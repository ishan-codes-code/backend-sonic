import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import { Readable } from 'stream';
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2Service {

    private s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY!,
            secretAccessKey: process.env.R2_SECRET_KEY!,
        },
    })

    private readonly bucketName = process.env.R2_BUCKET!;

    async uploadFile(file: Express.Multer.File) {
        const key = `${randomUUID()}-${file.originalname}`
        try {
            await this.s3.send(
                new PutObjectCommand({
                    Bucket: process.env.R2_BUCKET,
                    Key: key,
                    Body: file.buffer,
                    ContentType: file.mimetype,
                })
            )
            return {
                key,
                message: 'Uploaded to R2 successfully',
            }
        } catch (err) {
            console.log(err)
            throw err
        }

    }

    async uploadStream(
        stream: Readable,
        filename: string,
    ) {

        // const key = `${randomUUID()}-${filename}`
        const key = `songs/${filename}`;

        try {

            const upload = new Upload({
                client: this.s3,
                params: {
                    Bucket: process.env.R2_BUCKET!,
                    Key: key,
                    Body: stream, // direct
                    ContentType: 'audio/mpeg',
                },
            })

            await upload.done()

            return key

        } catch (err) {

            console.error('❌ R2 Upload Failed:', err)
            stream.destroy()
            throw new Error('R2 upload failed')

        }
    }

    async getSignedUrl(key: string): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });

            // Expiry: 5 minutes = 300 seconds
            const url = await getSignedUrl(this.s3, command, { expiresIn: 300 });
            return url;
        } catch (err) {
            console.error('❌ Signed URL generation failed:', err);
            throw new Error('Failed to generate signed URL');
        }
    }





}
