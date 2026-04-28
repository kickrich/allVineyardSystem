require "aws-sdk-s3"

minio_endpoint = ENV["MINIO_ENDPOINT"].to_s.strip
minio_access_key = ENV["MINIO_ACCESS_KEY"].to_s.strip
minio_secret_key = ENV["MINIO_SECRET_KEY"].to_s.strip
minio_bucket = ENV["MINIO_BUCKET"].to_s.strip
minio_region = ENV.fetch("MINIO_REGION", "us-east-1").to_s.strip

if minio_endpoint.present? && minio_access_key.present? && minio_secret_key.present? && minio_bucket.present?
  begin
    s3 = Aws::S3::Client.new(
      endpoint: minio_endpoint,
      region: minio_region.presence || "us-east-1",
      access_key_id: minio_access_key,
      secret_access_key: minio_secret_key,
      force_path_style: true
    )

    begin
      s3.head_bucket(bucket: minio_bucket)
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchBucket
      s3.create_bucket(bucket: minio_bucket)
      Rails.logger.info("[MinIO] Created missing bucket: #{minio_bucket}")
    rescue Aws::S3::Errors::ServiceError => e
      code = e.code.to_s
      if %w[NotFound NoSuchBucket 404].include?(code) || e.message.to_s.match?(/NoSuchBucket|NotFound|404/i)
        s3.create_bucket(bucket: minio_bucket)
        Rails.logger.info("[MinIO] Created missing bucket: #{minio_bucket}")
      else
        raise
      end
    end
  rescue StandardError => e
    Rails.logger.warn("[MinIO] Bucket check failed: #{e.class}: #{e.message}")
  end
end
