class KmlPolygonParser
  class ParseError < StandardError; end

  def self.call(input)
    new(input).call
  end

  def initialize(input)
    @input = input
  end

  def call
    xml = read_xml
    coordinates_text = extract_coordinates_text(xml)
    points = parse_points(coordinates_text)
    raise ParseError, "В KML недостаточно точек для полигона" if points.size < 4

    points << points.first unless points.first == points.last
    points
  end

  private

  attr_reader :input

  def read_xml
    return input.read.to_s if input.respond_to?(:read)
    input.to_s
  end

  def extract_coordinates_text(xml)
    match = xml.match(/<coordinates[^>]*>(.*?)<\/coordinates>/m)
    raise ParseError, "В KML не найден блок <coordinates>" unless match

    match[1].to_s.strip
  end

  def parse_points(coordinates_text)
    points = coordinates_text.split(/\s+/).filter_map do |pair|
      lng, lat = pair.split(",")
      next if lng.blank? || lat.blank?

      [Float(lng), Float(lat)]
    rescue ArgumentError
      raise ParseError, "Некорректные координаты в KML: #{pair}"
    end

    raise ParseError, "В KML не найдено ни одной координаты" if points.empty?
    points
  end
end
