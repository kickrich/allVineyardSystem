class VideoShard < ApplicationRecord
  belongs_to :video
  has_one_attached :video_file

  validate :video_file_readability, if: :file_persisted?
  validate :video_file_size, if: :file_persisted?
  validate :video_file_format, if: :file_persisted?
  validate :video_duration, if: :file_persisted?
  validate :video_resolution, if: :file_persisted?
  validate :video_frame_rate, if: :file_persisted?

  validates :shard_index, presence: true, uniqueness: { scope: :video_id }
  validates :original_filename, presence: true

  after_commit :update_video_status, if: :saved_change_to_status?
  after_create :update_video_status

  enum :status, {
    pending: 0,
    processing: 1,
    completed: 2,
    error: 3
  }

  def row_sequence
    result_json&.dig('row_sequence') || []
  end

  private

  def update_video_status
    video.recalculate_status!
    
    if video.status == 'completed' && video.external_service?
      SendResultsToExternalServiceJob.perform_later(video.id)
    end
  end

  def file_persisted?
    video_file.attached? && video_file.blob.persisted?
  end

  def video_file_readability
    movie = load_movie
    errors.add(:video_file, "не удалось прочитать видео") unless movie&.valid?
  end

  def video_file_size
    if video_file.byte_size < 1.megabyte
      errors.add(:video_file, "слишком маленький файл (минимум 1 МБ)")
    elsif video_file.byte_size > 2.gigabytes
      errors.add(:video_file, "слишком большой файл (максимум 2 ГБ)")
    end
  end

  def video_file_format
    allowed_types = [
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska"
    ]

    unless allowed_types.include?(video_file.content_type)
      errors.add(:video_file, "#{video_file.filename} не является допустимым видеоформатом (MP4, MOV, AVI, MKV)")
    end
  end

  def video_duration
    movie = load_movie
    return unless movie&.valid?

    if movie.duration < 5
      errors.add(:video_file, "слишком короткое видео (минимум 5 секунд)")
    elsif movie.duration > 300
      errors.add(:video_file, "слишком длинное видео (максимум 10 минут)")
    end
  end

  def video_resolution
    movie = load_movie
    return unless movie&.valid?

    if movie.width < 1280 || movie.height < 720
      errors.add(:video_file, "слишком низкое разрешение (минимум 1280x720)")
    end
  end

  def video_frame_rate
    movie = load_movie
    return unless movie&.valid?

    if movie.frame_rate < 24
      errors.add(:video_file, "слишком низкая частота кадров (минимум 24 fps)")
    end
  end

  def load_movie
    return @movie if defined?(@movie)

    begin
      unless video_file.attached?
        errors.add(:video_file, "файл не прикреплен")
        return nil
      end

      blob = video_file.blob

      temp_file = Tempfile.new(['video'.force_encoding('UTF-8'), File.extname(blob.filename.to_s)])
      temp_file.binmode

      blob.open do |file|
        IO.copy_stream(file, temp_file)
      end

      temp_file.rewind
      @movie = FFMPEG::Movie.new(temp_file.path)
      @movie
    rescue => e
      errors.add(:video_file, "не удалось загрузить видео")
      nil
    ensure
      if defined?(temp_file) && temp_file
        temp_file.close
        temp_file.unlink
      end
    end
  end
end