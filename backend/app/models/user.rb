class User < ApplicationRecord
  ACTIVE_MISSION_STATUS = :in_progress

  has_many :missions
  has_secure_password

  before_validation :normalize_email
  before_validation :strip_name
  before_destroy :ensure_no_active_missions

  # Валидации
  validates :name, presence: { message: "не может быть пустым" },
                   length: { minimum: 2, maximum: 100, message: "должно быть от 2 до 100 символов" }
  validates :email, presence: { message: "не может быть пустым" },
                    uniqueness: { case_sensitive: false, message: "уже используется" },
                    length: { maximum: 255 },
                    format: { with: /\A[^@\s]+@[^@\s]+\z/, message: "имеет неверный формат" }
  validates :password, length: { minimum: 6, message: "должен быть не короче 6 символов" }, allow_nil: true

  scope :ordered_by_name, -> { order(:name) }

  private

  def normalize_email
    self.email = email.to_s.strip.downcase.presence if email.present?
  end

  def strip_name
    self.name = name.to_s.strip.presence if name.present?
  end

  def ensure_no_active_missions
    return unless missions.where(status: ACTIVE_MISSION_STATUS).exists?
    errors.add(:base, "Нельзя удалить пользователя с активной миссией. Завершите или отмените миссию.")
    throw(:abort)
  end
end
