# frozen_string_literal: true

# Разрешение каталога TEST_MISSION_SHARD_VIDEOS_DIR и проверка имён файлов (как в TestMissionVideoShardsController).
class TestMissionShardDisk
  VIDEO_EXT = %w[.webm .mp4].freeze

  class << self
    def root_directory
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

    # Абсолютный путь к файлу шарда или nil, если имя или путь недопустимы.
    def absolute_path_for_shard(shard_filename)
      dir = root_directory
      return nil if dir.nil? || !safe_shard_filename?(shard_filename)

      path = dir.join(shard_filename.to_s)
      return path if path.file?

      nil
    end

    def content_type_for_path(path)
      case path.extname.downcase
      when ".mp4" then "video/mp4"
      when ".webm" then "video/webm"
      else "application/octet-stream"
      end
    end

    private

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

    def safe_shard_filename?(name)
      s = name.to_s
      s.present? &&
        !s.include?("..") &&
        !s.include?("/") &&
        !s.include?("\\") &&
        s.match?(/\A[0-9A-Za-z._-]+\z/) &&
        VIDEO_EXT.include?(File.extname(s).downcase)
    end
  end
end
