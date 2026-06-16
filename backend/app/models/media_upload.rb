class MediaUpload < ApplicationRecord
  belongs_to :mission
  has_one_attached :media_file

  MEDIA_TYPES = %w[image video].freeze
  STATUSES = %w[uploading uploaded processing ready sent_to_vineyard failed].freeze
  DEFAULT_STATUS = "uploaded"
  UPLOADING_STATUS = "uploading"
  # approved — на случай гонки UI (запрос multipart до перехода in_progress);
  # in_progress/completed — основной сценарий записи с дрона.
  # planned — запись/загрузка видео до approve (симулятор, гонка UI с multipart_init).
  ACCEPTED_MISSION_STATUSES = %i[planned approved in_progress completed].freeze

  MAX_URL_LENGTH = 500
  URL_FORMAT = %r{\Ahttps?://}.freeze
  MAX_VIDEO_SIZE_BYTES = 1.gigabyte
  ALLOWED_VIDEO_CONTENT_TYPES = %w[video/mp4 video/webm].freeze
  ALLOWED_IMAGE_CONTENT_TYPES = %w[image/jpeg image/png image/webp].freeze

  before_validation :strip_url
  before_validation :set_default_status

  validates :mission, presence: { message: "должна быть указана" }
  validates :media_type, presence: { message: "не может быть пустым" },
                        inclusion: { in: MEDIA_TYPES, message: "должен быть image или video" }
  validates :status,
            inclusion: { in: STATUSES, message: "должен быть uploading, uploaded, processing, ready или failed" }
  validates :url,
            length: { maximum: MAX_URL_LENGTH, message: "не более #{MAX_URL_LENGTH} символов" },
            format: { with: URL_FORMAT, message: "должен начинаться с http:// или https://" },
            allow_nil: true

  validate :mission_accepts_media
  validate :url_or_file_present
  validate :attached_file_rules

  scope :for_mission, ->(mission_id) { where(mission_id: mission_id) }
  scope :by_type, ->(type) { where(media_type: type) }
  scope :by_status, ->(status) { where(status: status) }

  # После того как видео готово, отправляем его в VineyardApp
  after_commit :send_to_vineyard_app, if: :video_ready_for_processing?

  private

  def video_ready_for_processing?
    return false unless saved_change_to_status? && status == 'ready' && media_type == 'video'
    return false if mission.blank?

    # Видео в S3/MinIO часто становится ready до completed миссии; ждать completed — интеграция не срабатывала.
    ACCEPTED_MISSION_STATUSES.any? { |status_name| mission.public_send("#{status_name}?") }
  end

  def send_to_vineyard_app
    SendVideoToVineyardAppJob.perform_later(id)
  end

  def strip_url
    self.url = url.to_s.strip.presence if url.present?
  end

  def set_default_status
    self.status = DEFAULT_STATUS if status.blank?
  end

  def mission_accepts_media
    return if mission.blank?
    # Медиа принимаем только когда миссия уже выполняется или завершена.
    return if ACCEPTED_MISSION_STATUSES.any? { |status_name| mission.public_send("#{status_name}?") }

    errors.add(:mission, "должна быть в статусе approved, in_progress или completed для приёма медиа")
  end

  def url_or_file_present
    # Для multipart/resumable сессии в статусе uploading файл может появиться позже.
    return if status == UPLOADING_STATUS
    # При обновлении статуса на ready без файла (для тестирования интеграции)
    # разрешаем обновление, если это не initial создание
    return if status == 'ready' && id.present? && MediaUpload.exists?(id: id)

    return if url.present? || media_file.attached?

    errors.add(:base, "нужно указать url или загрузить файл")
  end
   
                      
  def attached_file_rules
    return unless media_file.attached?

    if media_type == "video"
      unless ALLOWED_VIDEO_CONTENT_TYPES.include?(media_file.content_type)
        errors.add(:media_file, "для video допустимы только mp4/webm")
      end

      if media_file.blob.byte_size > MAX_VIDEO_SIZE_BYTES
        errors.add(:media_file, "слишком большой файл, максимум #{MAX_VIDEO_SIZE_BYTES / 1.megabyte} MB")
      end
    elsif media_type == "image"
      unless ALLOWED_IMAGE_CONTENT_TYPES.include?(media_file.content_type)
        errors.add(:media_file, "для image допустимы jpeg/png/webp")
      end
    end
  end
end
