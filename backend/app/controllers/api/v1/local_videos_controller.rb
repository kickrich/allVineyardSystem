# frozen_string_literal: true

module Api
  module V1
    class LocalVideosController < BaseController
      # GET /api/v1/local_videos?rows_count=2
      def index
        rows_count = params[:rows_count].to_i
        if rows_count < 1
          render_errors("rows_count обязателен и должен быть >= 1", status: :unprocessable_entity)
          return
        end

        catalog = LocalVideosCatalogService.new
        unless catalog.configured?
          render_errors(
            "Укажите LOCAL_VIDEOS_FOLDER в backend/.env (существующая папка с .mp4/.webm)",
            status: :unprocessable_entity
          )
          return
        end

        files = catalog.files_for_rows(rows_count)
        render_data(
          files.map do |file|
            file.merge(
              download_path: "/api/v1/local_videos/#{CGI.escape(file[:name])}"
            )
          end
        )
      rescue LocalVideosCatalogService::Error => e
        render_errors(e.message, status: :unprocessable_entity)
      end

      # POST /api/v1/local_videos/upload_to_minio
      # Параметры: mission_id, rows_count, shift_segment_indices (optional)
      def upload_to_minio
        mission_id = params[:mission_id].to_i
        rows_count = params[:rows_count].to_i

        if mission_id <= 0
          render_errors("mission_id обязателен", status: :unprocessable_entity)
          return
        end
        if rows_count < 1
          render_errors("rows_count обязателен и должен быть >= 1", status: :unprocessable_entity)
          return
        end

        uploads = LocalVideosMinioUploadService.new.upload_for_mission!(
          mission_id: mission_id,
          rows_count: rows_count,
          shift_segment_indices: parsed_shift_segment_indices_param
        )

        render_data({ uploads: uploads }, status: :created)
      rescue LocalVideosCatalogService::Error, LocalVideosMinioUploadService::Error => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue S3MultipartUploadService::ConfigError => e
        render_errors(e.message, status: :unprocessable_entity)
      rescue Aws::S3::Errors::ServiceError => e
        Rails.logger.error("[local_videos#upload_to_minio] S3 #{e.class} code=#{e.code.inspect} message=#{e.message}")
        render_errors("S3 upload failed: #{e.message}", status: :unprocessable_entity)
      rescue Seahorse::Client::NetworkingError, Errno::ECONNREFUSED, SocketError => e
        Rails.logger.error("[local_videos#upload_to_minio] network #{e.class}: #{e.message}")
        render_errors(
          "MinIO/S3 недоступен (#{e.message}). Проверьте docker compose up -d и S3_ENDPOINT в backend/.env.",
          status: :service_unavailable
        )
      rescue ActiveRecord::RecordInvalid => e
        render_errors(e.record.errors.full_messages, status: :unprocessable_entity)
      end

      # GET /api/v1/local_videos/:filename
      def show
        catalog = LocalVideosCatalogService.new
        filename = CGI.unescape(params[:filename].to_s)
        path = catalog.safe_path_for(filename)
        send_file path,
                  filename: File.basename(path),
                  disposition: "inline",
                  type: catalog.content_type_for_path(path)
      rescue LocalVideosCatalogService::Error => e
        render_errors(e.message, status: :not_found)
      end

      private

      def parsed_shift_segment_indices_param
        raw = params[:shift_segment_indices]
        arr =
          case raw
          when Array
            raw
          when String
            begin
              JSON.parse(raw)
            rescue JSON::ParserError
              []
            end
          else
            []
          end

        arr
          .map { |v| Integer(v, exception: false) }
          .compact
          .select { |i| i >= 0 }
          .uniq
          .sort
      end
    end
  end
end
