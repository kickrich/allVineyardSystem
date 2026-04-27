# frozen_string_literal: true

module Api
  module V1
    # Раздаёт тестовые видеофайлы для режима «шарды с диска» во фронте при симуляции миссии.
    # Папка: ENV["TEST_MISSION_SHARD_VIDEOS_DIR"] — относительно Rails.root или абсолютный путь; допускается
    # каталог внутри backend/ и стандартная папка монорепо ../test_mission_shard_videos (рядом с backend/).
    class TestMissionVideoShardsController < BaseController
      # Без JWT: blob-скачивание из браузера стабильно ломается на 401; доступ всё равно режется
      # ensure_shard_directory! (только development или ENABLE_TEST_MISSION_VIDEO_SHARDS + папка).
      skip_before_action :authenticate_request!

      VIDEO_EXT = %w[.webm .mp4].freeze

      before_action :ensure_shard_directory!

      def index
        files =
          @shard_directory
            .children
            .select(&:file?)
            .map { |p| utf8_label(p.basename.to_s) }
            .select { |name| name.present? && VIDEO_EXT.include?(File.extname(name).downcase) }
            .sort_by { |n| n.downcase }

        rel =
          begin
            utf8_label(@shard_directory.relative_path_from(Rails.root.expand_path).to_s)
          rescue ArgumentError, Encoding::InvalidByteSequenceError, Encoding::UndefinedConversionError
            utf8_label(@shard_directory.to_s)
          end

        render_data({ files: files, directory: rel })
      end

      def download
        name = params.require(:name).to_s
        unless safe_shard_filename?(name)
          render_errors("Недопустимое имя файла", status: :bad_request)
          return
        end

        path = @shard_directory.join(name)
        unless path.file?
          render_errors("Файл не найден", status: :not_found)
          return
        end

        send_file path.to_s, filename: name, type: content_type_for(path), disposition: "inline"
      end

      private

      def ensure_shard_directory!
        unless Rails.env.development? || truthy_param?(ENV["ENABLE_TEST_MISSION_VIDEO_SHARDS"])
          render_errors("Тестовые шард-видео отключены", status: :not_found)
          return
        end

        @shard_directory = resolve_shard_directory
        unless @shard_directory&.directory?
          render_errors("Папка TEST_MISSION_SHARD_VIDEOS_DIR не найдена или недоступна", status: :not_found)
          return
        end
      end

      def resolve_shard_directory
        raw = ENV.fetch("TEST_MISSION_SHARD_VIDEOS_DIR", "").to_s.strip
        return nil if raw.blank?

        base = Pathname.new(raw).absolute? ? Pathname.new(raw) : Rails.root.join(raw)
        base = base.expand_path
        return nil unless base.directory?
        return nil unless shard_videos_path_allowed?(base)

        base
      rescue Errno::ENOENT, SystemCallError
        nil
      end

      # Разрешаем каталоги под Rails.root (backend/) и стандартную папку монорепо
      # {repo}/test_mission_shard_videos (например ../test_mission_shard_videos от backend/).
      def shard_videos_path_allowed?(base)
        b = base.realpath
        root = Rails.root.realpath
        return true if path_within?(b, root)

        repo = root.parent.realpath
        default = (repo + "test_mission_shard_videos").realpath
        path_within?(b, default)
      rescue Errno::ENOENT, SystemCallError, ArgumentError
        false
      end

      def path_within?(path, base)
        child = path.realpath
        ancestor = base.realpath
        return true if child == ancestor

        child.relative_path_from(ancestor)
        true
      rescue ArgumentError, Errno::ENOENT, SystemCallError
        false
      end

      def utf8_label(str)
        str.to_s.encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "?")
      end

      def safe_shard_filename?(name)
        name.present? &&
          !name.include?("..") &&
          !name.include?("/") &&
          !name.include?("\\") &&
          name.match?(/\A[0-9A-Za-z._-]+\z/) &&
          VIDEO_EXT.include?(File.extname(name).downcase)
      end

      def content_type_for(path)
        case path.extname.downcase
        when ".mp4" then "video/mp4"
        when ".webm" then "video/webm"
        else "application/octet-stream"
        end
      end
    end
  end
end
