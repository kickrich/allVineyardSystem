class S3MultipartUploadService
  class ConfigError < StandardError; end

  DEFAULT_EXPIRES_IN_SECONDS = 15.minutes.to_i

  def initialize
    @bucket = ENV["S3_BUCKET"].to_s
    raise ConfigError, "S3_BUCKET is not configured" if @bucket.blank?

    access_key_id = ENV["S3_ACCESS_KEY_ID"].to_s
    secret_access_key = ENV["S3_SECRET_ACCESS_KEY"].to_s
    region = ENV.fetch("S3_REGION", "us-east-1")
    endpoint = ENV["S3_ENDPOINT"].to_s
    force_path_style = ENV.fetch("S3_FORCE_PATH_STYLE", "true") == "true"

    @client = Aws::S3::Client.new(
      access_key_id: access_key_id.presence,
      secret_access_key: secret_access_key.presence,
      region: region,
      endpoint: endpoint.presence,
      force_path_style: force_path_style
    )
    @endpoint = endpoint
    @region = region

    ensure_bucket_exists!
  end

  def create_multipart_upload(key:, content_type:)
    response = client.create_multipart_upload(
      bucket: bucket,
      key: key,
      content_type: content_type
    )
    response.upload_id
  end

  def presign_upload_part(key:, upload_id:, part_number:, expires_in: DEFAULT_EXPIRES_IN_SECONDS)
    presigner = Aws::S3::Presigner.new(client: client)
    url = presigner.presigned_url(
      :upload_part,
      bucket: bucket,
      key: key,
      upload_id: upload_id,
      part_number: part_number,
      expires_in: expires_in
    )
    { url: url, headers: {} }
  end

  def list_uploaded_parts(key:, upload_id:)
    response = client.list_parts(bucket: bucket, key: key, upload_id: upload_id)
    response.parts.map { |part| { part_number: part.part_number, etag: part.etag } }
  end

  def complete_multipart_upload(key:, upload_id:, parts:)
    client.complete_multipart_upload(
      bucket: bucket,
      key: key,
      upload_id: upload_id,
      multipart_upload: {
        parts: parts.map { |part| { part_number: part[:part_number].to_i, etag: part[:etag].to_s } }
      }
    )
  end

  def abort_multipart_upload(key:, upload_id:)
    client.abort_multipart_upload(bucket: bucket, key: key, upload_id: upload_id)
  end

  def object_public_url(key)
    public_base = ENV["S3_PUBLIC_ENDPOINT"].to_s.sub(%r{/\z}, "")
    public_base = endpoint.to_s.sub(%r{/\z}, "") if public_base.blank?

    if public_base.present?
      "#{public_base}/#{bucket}/#{key}"
    else
      "https://#{bucket}.s3.#{region}.amazonaws.com/#{key}"
    end
  end

  def download_to_file(key:, path:)
    File.open(path, "wb") do |file|
      client.get_object(bucket: bucket, key: key) do |chunk|
        file.write(chunk)
      end
    end
    path
  end

  def upload_file(key:, path:, content_type:)
    File.open(path, "rb") do |file|
      client.put_object(
        bucket: bucket,
        key: key,
        body: file,
        content_type: content_type
      )
    end
    true
  end

  private

  attr_reader :client, :bucket, :endpoint, :region

  def ensure_bucket_exists!
    client.head_bucket(bucket: bucket)
  rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchBucket
    create_bucket_once!
  rescue Aws::S3::Errors::ServiceError => e
    code = e.code.to_s
    if %w[NotFound NoSuchBucket 404].include?(code) ||
        e.message.to_s.match?(/NoSuchBucket|NotFound|404/i)
      create_bucket_once!
    else
      raise
    end
  end

  def create_bucket_once!
    client.create_bucket(bucket: bucket)
  rescue Aws::S3::Errors::BucketAlreadyOwnedByYou, Aws::S3::Errors::BucketAlreadyExists
    # гонка или уже создан параллельно
  end
end
