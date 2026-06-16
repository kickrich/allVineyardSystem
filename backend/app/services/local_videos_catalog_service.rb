# frozen_string_literal: true

# Список видеофайлов из LOCAL_VIDEOS_FOLDER для автозагрузки по числу рядов.
class LocalVideosCatalogService
  VIDEO_EXTENSIONS = %w[.mp4 .m4v .webm].freeze

  class Error < StandardError; end

  def self.default_folder
    explicit = ENV["LOCAL_VIDEOS_FOLDER"].to_s.strip
    return explicit if explicit.present?

    File.expand_path("../local_videos", Rails.root)
  end

  def initialize(folder: self.class.default_folder)
    @folder = folder.to_s.strip
  end

  def configured?
    @folder.present? && Dir.exist?(@folder)
  end

  def files_for_rows(rows_count)
    raise Error, "LOCAL_VIDEOS_FOLDER не задан или папка не существует" unless configured?

    count = rows_count.to_i
    raise Error, "rows_count должен быть >= 1" if count < 1

    all = discover_files
    raise Error, "В папке #{@folder} нет видео (.mp4, .webm)" if all.empty?

    by_row = pick_by_row_names(all, count)
    picked =
      if by_row.size == count
        by_row
      else
        (1..count).map { |row| all[(row - 1) % all.size] }
      end
    picked.each_with_index.map do |path, index|
      {
        name: File.basename(path),
        row_index: index + 1,
        byte_size: File.size(path),
        content_type: content_type_for(path)
      }
    end
  end

  def safe_path_for(filename)
    raise Error, "LOCAL_VIDEOS_FOLDER не настроен" unless configured?

    base = File.basename(filename.to_s)
    raise Error, "Недопустимое имя файла" if base.blank? || base != filename.to_s

    path = File.expand_path(base, @folder)
    folder_real = File.realpath(@folder)
    file_real = File.realpath(path)
    raise Error, "Файл вне разрешённой папки" unless file_real.start_with?(folder_real + File::SEPARATOR) || file_real == folder_real

    raise Error, "Файл не найден" unless File.file?(file_real)

    file_real
  end

  def content_type_for_path(path)
    content_type_for(path)
  end

  private

  def discover_files
    Dir.glob(File.join(@folder, "*"), File::FNM_CASEFOLD)
      .select { |path| File.file?(path) && video_file?(path) }
      .sort_by { |path| [row_number_from_name(File.basename(path)) || 999_999, File.basename(path).downcase] }
  end

  def pick_by_row_names(files, rows_count)
    (1..rows_count).filter_map do |row|
      files.find { |path| row_number_from_name(File.basename(path)) == row }
    end
  end

  def video_file?(path)
    VIDEO_EXTENSIONS.include?(File.extname(path).downcase)
  end

  def row_number_from_name(basename)
    name = File.basename(basename, ".*")
    if (m = name.match(/(?:^|[._-])row[_-]?(\d+)/i))
      m[1].to_i
    elsif (m = name.match(/\A(\d+)/))
      m[1].to_i
    end
  end

  def content_type_for(path)
    case File.extname(path).downcase
    when ".webm" then "video/webm"
    else "video/mp4"
    end
  end
end
