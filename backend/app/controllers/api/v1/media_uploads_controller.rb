module Api
  module V1
    class MediaUploadsController < BaseController
      before_action :set_media_upload, only: [:show, :update, :destroy]

      # GET /api/v1/media_uploads
      # Параметры: mission_id, media_type (image | video)
      def index
        media_uploads = MediaUpload.all
        media_uploads = media_uploads.for_mission(params[:mission_id]) if params[:mission_id].present?
        media_uploads = media_uploads.by_type(params[:media_type]) if params[:media_type].present?
        media_uploads = media_uploads.by_status(params[:status]) if params[:status].present?
        render_data(media_uploads.map { |item| media_upload_payload(item) })
      end

      # Показать медиа-загрузку GET /api/v1/media_uploads/:id
      def show
        render_data(media_upload_payload(@media_upload))
      end

      # Создать медиа-загрузку POST /api/v1/media_uploads
      def create
        @media_upload = MediaUpload.new(media_upload_params)
        if @media_upload.save
          render_data(media_upload_payload(@media_upload), status: :created)
        else
          render_errors(@media_upload.errors.full_messages, status: :unprocessable_entity)
        end
      end
      
      # Обновить медиа-загрузку PUT /api/v1/media_uploads/:id
      def update
        if @media_upload.update(media_upload_params)
          render_data(media_upload_payload(@media_upload))
        else
          render_errors(@media_upload.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # POST /api/v1/media_uploads/presign
      # Параметры: mission_id, media_type, filename, byte_size, checksum, content_type
      def presign
        mission = find_mission_or_render_error
        return if mission.nil?

        media_type = params[:media_type].to_s
        return unless ensure_valid_media_type!(media_type)

        byte_size = params[:byte_size].to_i
        content_type = params[:content_type].to_s
        if media_type == "video"
          if byte_size <= 0
            render_errors("byte_size должен быть положительным числом", status: :unprocessable_entity)
            return
          end
          if byte_size > MediaUpload::MAX_VIDEO_SIZE_BYTES
            render_errors("Видео слишком большое. Максимум #{MediaUpload::MAX_VIDEO_SIZE_BYTES / 1.megabyte} MB", status: :unprocessable_entity)
            return
          end
          unless MediaUpload::ALLOWED_VIDEO_CONTENT_TYPES.include?(content_type)
            render_errors("Недопустимый content_type для video", status: :unprocessable_entity)
            return
          end
        end

        blob = ActiveStorage::Blob.create_before_direct_upload!(
          filename: params[:filename].to_s,
          byte_size: byte_size,
          checksum: params[:checksum].to_s,
          content_type: content_type,
          metadata: {
            mission_id: mission.id,
            media_type: media_type
          }
        )

        render_data(
          {
            signed_blob_id: blob.signed_id,
            filename: blob.filename.to_s,
            byte_size: blob.byte_size,
            content_type: blob.content_type,
            direct_upload: {
              url: blob.service_url_for_direct_upload,
              headers: blob.service_headers_for_direct_upload
            }
          }
        )
      rescue ActiveRecord::RecordInvalid => e
        render_errors(e.message, status: :unprocessable_entity)
      end

      # POST /api/v1/media_uploads/complete
      # Параметры: mission_id, media_type, signed_blob_id, url(optional)
      def complete
        mission = find_mission_or_render_error
        return if mission.nil?

        media_type = params[:media_type].to_s
        return unless ensure_valid_media_type!(media_type)

        blob = ActiveStorage::Blob.find_signed(params[:signed_blob_id])
        if blob.nil?
          render_errors("signed_blob_id недействителен или истёк", status: :unprocessable_entity)
          return
        end

        media_upload = MediaUpload.new(
          mission_id: mission.id,
          media_type: media_type,
          url: params[:url],
          status: "uploaded"
        )
        media_upload.media_file.attach(blob)

        if media_upload.save
          render_data(media_upload_payload(media_upload), status: :created)
        else
          render_errors(media_upload.errors.full_messages, status: :unprocessable_entity)
        end
      rescue ActiveSupport::MessageVerifier::InvalidSignature
        render_errors("signed_blob_id недействителен или истёк", status: :unprocessable_entity)
      end

      # POST /api/v1/media_uploads/multipart_init
      # Параметры: mission_id, media_type, filename, byte_size, content_type, chunk_size_bytes(optional)
      def multipart_init
        mission = find_mission_or_render_error
        return if mission.nil?

        media_type = params[:media_type].to_s
        return unless ensure_valid_media_type!(media_type)

        byte_size = params[:byte_size].to_i
        content_type = params[:content_type].to_s
        filename = params[:filename].to_s
        chunk_size_bytes = (params[:chunk_size_bytes].presence || 5 * 1024 * 1024).to_i

        if byte_size <= 0 || filename.blank? || content_type.blank?
          render_errors("filename, byte_size и content_type обязательны", status: :unprocessable_entity)
          return
        end
        if chunk_size_bytes < 1024 * 1024
          render_errors("chunk_size_bytes слишком маленький", status: :unprocessable_entity)
          return
        end
        if media_type == "video"
          unless MediaUpload::ALLOWED_VIDEO_CONTENT_TYPES.include?(content_type)
            render_errors("Недопустимый content_type для video", status: :unprocessable_entity)
            return
          end
          if byte_size > MediaUpload::MAX_VIDEO_SIZE_BYTES
            render_errors("Видео слишком большое. Максимум #{MediaUpload::MAX_VIDEO_SIZE_BYTES / 1.megabyte} MB", status: :unprocessable_entity)
            return
          end
        end

        # Генерируем server-side сессию multipart и сохраняем метаданные,
        # чтобы клиент мог дозапрашивать presign-URL по частям.
        session_id = SecureRandom.hex(16)
        key = build_multipart_key(mission_id: mission.id, session_id: session_id, filename: filename)
        upload_id = multipart_service.create_multipart_upload(key: key, content_type: content_type)
        total_parts = (byte_size.to_f / chunk_size_bytes).ceil

        media_upload = MediaUpload.create!(
          mission_id: mission.id,
          media_type: media_type,
          status: "uploading",
          upload_session_id: session_id,
          upload_meta: {
            "storage" => "s3",
            "key" => key,
            "upload_id" => upload_id,
            "filename" => filename,
            "content_type" => content_type,
            "byte_size" => byte_size,
            "chunk_size_bytes" => chunk_size_bytes,
            "total_parts" => total_parts
          }
        )

        render_data(
          {
            media_upload_id: media_upload.id,
            upload_session_id: session_id,
            key: key,
            upload_id: upload_id,
            chunk_size_bytes: chunk_size_bytes,
            total_parts: total_parts
          },
          status: :created
        )
      rescue S3MultipartUploadService::ConfigError => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue Aws::S3::Errors::ServiceError => e
        Rails.logger.error("[multipart_init] S3 #{e.class} code=#{e.code.inspect} message=#{e.message}")
        render_errors("S3 multipart init failed: #{e.message}", status: :unprocessable_entity)
      rescue Seahorse::Client::NetworkingError, Errno::ECONNREFUSED, SocketError => e
        Rails.logger.error("[multipart_init] network #{e.class}: #{e.message}")
        render_errors(
          "MinIO/S3 недоступен (#{e.message}). Проверьте: docker compose up -d в корне allsystem, порт 9000, S3_ENDPOINT в backend/.env (лучше http://127.0.0.1:9000).",
          status: :service_unavailable
        )
      rescue ActiveRecord::RecordInvalid => e
        Rails.logger.warn("[multipart_init] validation: #{e.record.errors.full_messages.join(', ')}")
        render_errors(e.record.errors.full_messages, status: :unprocessable_entity)
      end

      # POST /api/v1/media_uploads/multipart_presign_part
      # Параметры: upload_session_id, part_number
      def multipart_presign_part
        media_upload = find_uploading_media_upload_or_render_error
        return if media_upload.nil?

        meta = media_upload.upload_meta || {}
        total_parts = meta["total_parts"].to_i
        part_number = params[:part_number].to_i
        if part_number <= 0 || part_number > total_parts
          render_errors("part_number должен быть в диапазоне 1..#{total_parts}", status: :unprocessable_entity)
          return
        end

        signed = multipart_service.presign_upload_part(
          key: meta["key"].to_s,
          upload_id: meta["upload_id"].to_s,
          part_number: part_number
        )

        render_data(
          {
            upload_session_id: media_upload.upload_session_id,
            part_number: part_number,
            url: signed[:url],
            headers: signed[:headers]
          }
        )
      rescue S3MultipartUploadService::ConfigError => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue Aws::S3::Errors::ServiceError => e
        Rails.logger.error("[multipart_presign_part] S3 #{e.class} code=#{e.code.inspect} message=#{e.message}")
        render_errors("S3 presign part failed: #{e.message}", status: :unprocessable_entity)
      rescue Seahorse::Client::NetworkingError, Errno::ECONNREFUSED, SocketError => e
        Rails.logger.error("[multipart_presign_part] network #{e.class}: #{e.message}")
        render_errors("MinIO/S3 недоступен: #{e.message}", status: :service_unavailable)
      end

      # GET /api/v1/media_uploads/multipart_list_parts?upload_session_id=...
      def multipart_list_parts
        media_upload = MediaUpload.find_by(upload_session_id: params[:upload_session_id].to_s)
        if media_upload.nil?
          render_errors("upload_session_id недействителен", status: :not_found)
          return
        end

        meta = media_upload.upload_meta || {}
        parts = multipart_service.list_uploaded_parts(
          key: meta["key"].to_s,
          upload_id: meta["upload_id"].to_s
        )

        render_data(
          {
            upload_session_id: media_upload.upload_session_id,
            uploaded_parts: parts
          }
        )
      rescue S3MultipartUploadService::ConfigError => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue Aws::S3::Errors::ServiceError => e
        render_errors("S3 list parts failed: #{e.message}", status: :unprocessable_entity)
      end

      # POST /api/v1/media_uploads/multipart_complete
      # Параметры: upload_session_id, parts: [{part_number, etag}]
      def multipart_complete
        media_upload = find_uploading_media_upload_or_render_error
        return if media_upload.nil?

        parts = Array(params[:parts]).map do |part|
          {
            part_number: part[:part_number] || part["part_number"],
            etag: part[:etag] || part["etag"]
          }
        end
        if parts.empty?
          render_errors("parts обязателен и не должен быть пустым", status: :unprocessable_entity)
          return
        end

        meta = media_upload.upload_meta || {}
        multipart_service.complete_multipart_upload(
          key: meta["key"].to_s,
          upload_id: meta["upload_id"].to_s,
          parts: parts
        )

        media_upload.update!(
          status: "processing",
          url: multipart_service.object_public_url(meta["key"].to_s),
          upload_meta: meta.merge(
            "source_key" => meta["key"].to_s,
            "source_url" => multipart_service.object_public_url(meta["key"].to_s)
          )
        )

        # Асинхронная конвертация webm → mp4 (url переключится на mp4 после готовности).
        if media_upload.media_type == "video"
          MediaUploadTranscodeJob.perform_later(media_upload.id)
        else
          media_upload.update!(status: "ready")
        end

        render_data(media_upload_payload(media_upload), status: :created)
      rescue S3MultipartUploadService::ConfigError => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue Aws::S3::Errors::ServiceError => e
        Rails.logger.error("[multipart_complete] S3 #{e.class} code=#{e.code.inspect} message=#{e.message}")
        render_errors("S3 complete multipart failed: #{e.message}", status: :unprocessable_entity)
      rescue Seahorse::Client::NetworkingError, Errno::ECONNREFUSED, SocketError => e
        Rails.logger.error("[multipart_complete] network #{e.class}: #{e.message}")
        render_errors("MinIO/S3 недоступен: #{e.message}", status: :service_unavailable)
      end

      # POST /api/v1/media_uploads/multipart_abort
      # Параметры: upload_session_id
      def multipart_abort
        media_upload = find_uploading_media_upload_or_render_error(completed_error: "Загрузка уже завершена")
        return if media_upload.nil?

        meta = media_upload.upload_meta || {}
        multipart_service.abort_multipart_upload(
          key: meta["key"].to_s,
          upload_id: meta["upload_id"].to_s
        )
        media_upload.update!(status: "failed", error_message: "multipart aborted by client")

        render_data(media_upload_payload(media_upload))
      rescue S3MultipartUploadService::ConfigError => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue Aws::S3::Errors::ServiceError => e
        render_errors("S3 abort multipart failed: #{e.message}", status: :unprocessable_entity)
      end

      # POST /api/v1/media_uploads/resumable_init
      # Для плохой связи: клиент/агент грузит видео частями (chunks) и может продолжить после обрыва.
      # Параметры (JSON): mission_id, media_type, filename, byte_size, content_type, chunk_size_bytes (опционально)
      def resumable_init
        mission = find_mission_or_render_error
        return if mission.nil?

        media_type = params[:media_type].to_s
        return unless ensure_valid_media_type!(media_type)

        if media_type == "video"
          unless MediaUpload::ALLOWED_VIDEO_CONTENT_TYPES.include?(params[:content_type].to_s)
            render_errors("Недопустимый content_type для video", status: :unprocessable_entity)
            return
          end
          byte_size = params[:byte_size].to_i
          if byte_size <= 0
            render_errors("byte_size должен быть положительным числом", status: :unprocessable_entity)
            return
          end
          if byte_size > MediaUpload::MAX_VIDEO_SIZE_BYTES
            render_errors("Видео слишком большое", status: :unprocessable_entity)
            return
          end
        end

        chunk_size_bytes = (params[:chunk_size_bytes].presence || 5 * 1024 * 1024).to_i
        if chunk_size_bytes < 1024 * 1024
          render_errors("chunk_size_bytes слишком маленький", status: :unprocessable_entity)
          return
        end

        byte_size = params[:byte_size].to_i
        total_parts = (byte_size.to_f / chunk_size_bytes).ceil
        if total_parts <= 0
          render_errors("Не удалось определить total_parts", status: :unprocessable_entity)
          return
        end

        session_id = SecureRandom.hex(16)
        meta = {
          "filename" => params[:filename].to_s,
          "content_type" => params[:content_type].to_s,
          "byte_size" => byte_size,
          "chunk_size_bytes" => chunk_size_bytes,
          "total_parts" => total_parts,
          "received_parts" => []
        }

        media_upload = MediaUpload.create!(
          mission_id: mission.id,
          media_type: media_type,
          status: "uploading",
          upload_session_id: session_id,
          upload_meta: meta
        )

        FileUtils.mkdir_p(upload_dir(media_upload))
        render_data(
          {
            upload_session_id: media_upload.upload_session_id,
            filename: meta["filename"],
            content_type: meta["content_type"],
            byte_size: meta["byte_size"],
            chunk_size_bytes: meta["chunk_size_bytes"],
            total_parts: meta["total_parts"],
            received_parts: []
          },
          status: :created
        )
      rescue ActiveRecord::RecordInvalid => e
        render_errors(e.record.errors.full_messages, status: :unprocessable_entity)
      end

      # POST /api/v1/media_uploads/resumable_upload_part
      # form-data: chunk (file), part_index (int), upload_session_id (string)
      def resumable_upload_part
        upload_session_id = params[:upload_session_id].to_s
        media_upload = MediaUpload.find_by(upload_session_id: upload_session_id)
        if media_upload.nil?
          render_errors("upload_session_id недействителен", status: :not_found)
          return
        end

        unless media_upload.status == "uploading"
          render_errors("Загрузка для этого upload_session_id уже завершена или не начата", status: :unprocessable_entity)
          return
        end

        meta = media_upload.upload_meta || {}
        total_parts = meta["total_parts"].to_i
        chunk = params[:chunk]
        part_index = params[:part_index].to_i

        if chunk.nil? || chunk.tempfile.nil?
          render_errors("chunk обязателен", status: :unprocessable_entity)
          return
        end
        if part_index.negative? || part_index >= total_parts
          render_errors("part_index вне диапазона", status: :unprocessable_entity)
          return
        end

        # with_lock нужен для корректной идемпотентности и защиты от гонок,
        # когда один и тот же part может прилететь повторно/параллельно.
        media_upload.with_lock do
          meta = (media_upload.upload_meta || {})
          received = Array(meta["received_parts"]).map(&:to_i)
          received_set = received.to_h { |i| [i, true] }

          part_path = File.join(upload_dir(media_upload), "part_#{part_index}.part")

          # Идемпотентность: если часть уже есть — не перезаписываем
          unless File.exist?(part_path)
            FileUtils.mkdir_p(upload_dir(media_upload))
            chunk.tempfile.rewind
            File.open(part_path, "wb") do |out|
              IO.copy_stream(chunk.tempfile, out)
            end
          end

          unless received_set[part_index]
            received << part_index
            meta["received_parts"] = received.sort
            media_upload.update!(upload_meta: meta)
          end
        end

        render_data(
          {
            part_index: part_index,
            received_parts: Array(media_upload.reload.upload_meta["received_parts"]).map(&:to_i),
            total_parts: total_parts
          }
        )
      end

      # POST /api/v1/media_uploads/resumable_complete
      # Параметры: upload_session_id
      def resumable_complete
        upload_session_id = params[:upload_session_id].to_s
        media_upload = MediaUpload.find_by(upload_session_id: upload_session_id)
        if media_upload.nil?
          render_errors("upload_session_id недействителен", status: :not_found)
          return
        end

        unless media_upload.status == "uploading"
          render_errors("Загрузка для этого upload_session_id уже завершена или не начата", status: :unprocessable_entity)
          return
        end

        meta = media_upload.upload_meta || {}
        filename = meta["filename"].to_s
        content_type = meta["content_type"].to_s
        total_parts = meta["total_parts"].to_i
        received = Array(meta["received_parts"]).map(&:to_i)

        expected = (0...total_parts).to_a
        missing = expected - received
        unless missing.empty?
          render_errors("Не все части загружены. Missing parts: #{missing.take(20)}", status: :unprocessable_entity)
          return
        end

        dir = upload_dir(media_upload)
        assembled_path = File.join(dir, "assembled_#{filename}")
        FileUtils.mkdir_p(dir)

        # Склеиваем файл строго по порядку частей 0...N-1.
        File.open(assembled_path, "wb") do |out|
          expected.each do |i|
            part_path = File.join(dir, "part_#{i}.part")
            unless File.exist?(part_path)
              render_errors("Часть #{i} отсутствует на сервере", status: :unprocessable_entity)
              return
            end
            File.open(part_path, "rb") { |inp| IO.copy_stream(inp, out) }
          end
        end

        media_upload.media_file.attach(
          io: File.open(assembled_path, "rb"),
          filename: filename.presence || "upload.bin",
          content_type: content_type
        )

        media_upload.update!(
          status: "uploaded"
        )

        render_data(media_upload_payload(media_upload), status: :created)
      rescue StandardError => e
        render_errors(e.message, status: :unprocessable_entity)
      end

      def destroy
        @media_upload.destroy
        head :no_content
      end

      private

      def set_media_upload
        @media_upload = MediaUpload.find(params[:id])
      end

      def media_upload_params
        params.require(:media_upload).permit(:mission_id, :media_type, :url, :status, :media_file)
      end

      def media_upload_payload(media_upload)
        {
          id: media_upload.id,
          mission_id: media_upload.mission_id,
          media_type: media_upload.media_type,
          status: media_upload.status,
          url: media_upload.url,
          upload_session_id: media_upload.respond_to?(:upload_session_id) ? media_upload.upload_session_id : nil,
          file_attached: media_upload.media_file.attached?,
          file_content_type: media_upload.media_file.attached? ? media_upload.media_file.content_type : nil,
          file_byte_size: media_upload.media_file.attached? ? media_upload.media_file.blob.byte_size : nil,
          created_at: media_upload.created_at,
          updated_at: media_upload.updated_at
        }
      end

      def upload_dir(media_upload)
        Rails.root.join("tmp", "resumable_media_uploads", media_upload.id.to_s)
      end

      def multipart_service
        @multipart_service ||= S3MultipartUploadService.new
      end

      def build_multipart_key(mission_id:, session_id:, filename:)
        safe_filename = filename.gsub(/[^\w.\-]/, "_")
        "missions/#{mission_id}/uploads/#{session_id}/#{safe_filename}"
      end

      def find_mission_or_render_error
        mission = Mission.find_by(id: params[:mission_id])
        if mission.nil?
          render_errors("Миссия не найдена", status: :not_found)
          return nil
        end
        mission
      end

      def ensure_valid_media_type!(media_type)
        return true if MediaUpload::MEDIA_TYPES.include?(media_type)

        render_errors("media_type должен быть image или video", status: :unprocessable_entity)
        false
      end

      def find_uploading_media_upload_or_render_error(completed_error: "Загрузка не в статусе uploading")
        # Общая проверка upload_session_id + допустимого статуса сессии.
        media_upload = MediaUpload.find_by(upload_session_id: params[:upload_session_id].to_s)
        if media_upload.nil?
          render_errors("upload_session_id недействителен", status: :not_found)
          return nil
        end
        if media_upload.status != "uploading"
          render_errors(completed_error, status: :unprocessable_entity)
          return nil
        end

        media_upload
      end
    end
  end
end