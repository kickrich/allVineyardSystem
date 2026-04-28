class DroneLog < ApplicationRecord
  belongs_to :user
  belongs_to :drone, optional: true

  validates :message, presence: true, length: { maximum: 500 }
  validate :data_must_be_object
  validates :logged_at, presence: true

  scope :recent_first, -> { order(logged_at: :desc, id: :desc) }

  private

  def data_must_be_object
    return if data.nil? || data.is_a?(Hash)
    errors.add(:data, "должно быть объектом JSON")
  end
end
