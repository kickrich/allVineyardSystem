# app/models/zone.rb
class Zone < ApplicationRecord
  has_many :missions, dependent: :restrict_with_error
  has_many :route_templates, dependent: :nullify
  has_one_attached :kml_file

  before_validation :strip_name_and_description

  validates :name, presence: { message: "не может быть пустым" },
                   length: { minimum: 2, maximum: 100, message: "должно быть от 2 до 100 символов" }
  validates :color, format: {
    with: /\A#[0-9a-fA-F]{6}\z/,
    message: "должен быть в HEX-формате #RRGGBB"
  }
  validates :description, length: { maximum: 1000 }, allow_nil: true
  validate :boundary_valid
  validate :boundary_does_not_touch_or_overlap_other_zones

  scope :ordered_by_name, -> { order(:name) }

  # boundary: jsonb — массив точек [ [lng, lat], ... ] или []
  def boundary_valid
    return if boundary.nil?
    return errors.add(:boundary, "должен быть массивом") unless boundary.is_a?(Array)
    return errors.add(:boundary, "должен содержать минимум 4 точки") if boundary.size < 4
    return errors.add(:boundary, "полигон должен быть замкнут: первая и последняя точки должны совпадать") unless boundary.first == boundary.last

    boundary.each_with_index do |point, i|
      unless point.is_a?(Array) && point.size == 2 && point.all? { |v| v.is_a?(Numeric) }
        errors.add(:boundary, "точка #{i + 1} должна быть массивом [долгота, широта] с числами")
        break
      end

      lng, lat = point
      unless (-180.0..180.0).cover?(lng) && (-90.0..90.0).cover?(lat)
        errors.add(:boundary, "точка #{i + 1} должна быть в диапазонах: долгота -180..180, широта -90..90")
        break
      end
    end
  end

  private

  def strip_name_and_description
    self.name = name.to_s.strip.presence if name.present?
    self.description = description.to_s.strip.presence if description.present?
  end

  def boundary_does_not_touch_or_overlap_other_zones
    return if boundary.blank? || errors.include?(:boundary)

    current_ring = normalized_ring(boundary)
    return if current_ring.nil?

    Zone.where.not(id: id).find_each do |other|
      other_ring = normalized_ring(other.boundary)
      next if other_ring.nil?
      next unless polygons_touch_or_overlap?(current_ring, other_ring)

      errors.add(:boundary, "не должна пересекаться или соприкасаться с зоной \"#{other.name}\"")
      break
    end
  end

  def normalized_ring(raw_boundary)
    return nil unless raw_boundary.is_a?(Array) && raw_boundary.size >= 4
    return nil unless raw_boundary.first == raw_boundary.last

    raw_boundary.map do |point|
      return nil unless point.is_a?(Array) && point.size == 2
      lng = Float(point[0], exception: false)
      lat = Float(point[1], exception: false)
      return nil if lng.nil? || lat.nil?

      [lng, lat]
    end
  end

  def polygons_touch_or_overlap?(ring_a, ring_b)
    segs_a = polygon_segments(ring_a)
    segs_b = polygon_segments(ring_b)

    segs_a.each do |a1, a2|
      segs_b.each do |b1, b2|
        return true if segments_intersect_or_touch?(a1, a2, b1, b2)
      end
    end

    points_a = ring_a[0...-1]
    points_b = ring_b[0...-1]
    return true if points_a.any? { |p| point_inside_or_on_polygon?(p, ring_b) }
    return true if points_b.any? { |p| point_inside_or_on_polygon?(p, ring_a) }

    false
  end

  def polygon_segments(ring)
    (0...(ring.length - 1)).map { |i| [ring[i], ring[i + 1]] }
  end

  def segments_intersect_or_touch?(p1, q1, p2, q2)
    o1 = orientation(p1, q1, p2)
    o2 = orientation(p1, q1, q2)
    o3 = orientation(p2, q2, p1)
    o4 = orientation(p2, q2, q1)

    return true if o1 != o2 && o3 != o4
    return true if o1.zero? && point_on_segment?(p2, p1, q1)
    return true if o2.zero? && point_on_segment?(q2, p1, q1)
    return true if o3.zero? && point_on_segment?(p1, p2, q2)
    return true if o4.zero? && point_on_segment?(q1, p2, q2)

    false
  end

  # 0 -> коллинеарно, 1 -> по часовой, 2 -> против часовой
  def orientation(a, b, c)
    val = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
    eps = 1e-10
    return 0 if val.abs <= eps

    val.positive? ? 1 : 2
  end

  def point_on_segment?(p, a, b)
    eps = 1e-10
    p[0] <= [a[0], b[0]].max + eps &&
      p[0] >= [a[0], b[0]].min - eps &&
      p[1] <= [a[1], b[1]].max + eps &&
      p[1] >= [a[1], b[1]].min - eps
  end

  def point_inside_or_on_polygon?(point, polygon)
    x, y = point

    (0...(polygon.length - 1)).each do |i|
      a = polygon[i]
      b = polygon[i + 1]
      return true if orientation(a, b, point).zero? && point_on_segment?(point, a, b)
    end

    inside = false
    j = polygon.length - 1
    (0...polygon.length).each do |i|
      xi, yi = polygon[i]
      xj, yj = polygon[j]
      if ((yi > y) != (yj > y)) && (x < ((xj - xi) * (y - yi) / ((yj - yi).nonzero? || Float::EPSILON)) + xi)
        inside = !inside
      end
      j = i
    end
    inside
  end

end
