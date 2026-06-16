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
    end
  end
end
