# frozen_string_literal: true

require "json"

class OsmBuildingsService
  OVERPASS_ENDPOINTS = [
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ].freeze

  MAX_BUILDING_FOOTPRINT_AREA_M2 = 25_000
  CACHE_TTL = 15.minutes
  NEGATIVE_CACHE_TTL = 5.minutes
  STALE_CACHE_KEY = "osm_buildings:last_success"
  STALE_CACHE_TTL = 24.hours

  READ_TIMEOUT = 25
  OPEN_TIMEOUT = 10
  OVERPASS_QUERY_TIMEOUT = 30

  MAX_BBOX_LAT_SPAN = 0.055
  MAX_BBOX_LNG_SPAN = 0.055

  class Error < StandardError; end

  def initialize(south:, west:, north:, east:)
    @south = south.to_f
    @west = west.to_f
    @north = north.to_f
    @east = east.to_f
  end

  def call
    return [] if invalid_coordinates?

    validate_bbox!
    clamp_bbox_to_max_span!

    cache_key = build_cache_key
    negative_key = "#{cache_key}:negative"
    cached_negative = Rails.cache.read(negative_key)
    return cached_negative if cached_negative.is_a?(Array)

    buildings = Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
      fetched = fetch_buildings_parallel
      Rails.cache.write(STALE_CACHE_KEY, fetched, expires_in: STALE_CACHE_TTL)
      fetched
    end

    buildings.is_a?(Array) ? buildings : []
  rescue Error, Faraday::Error => e
    Rails.logger.error("[OsmBuildingsService] #{e.message}")
    stale = Rails.cache.read(STALE_CACHE_KEY)
    return stale if stale.is_a?(Array)

    Rails.cache.write(negative_key, [], expires_in: NEGATIVE_CACHE_TTL)
    []
  end

  private

  def invalid_coordinates?
    [@south, @west, @north, @east].any? { |v| !v.finite? || v.nan? }
  end

  def build_cache_key
    [
      "osm_buildings",
      format("%.4f", @south),
      format("%.4f", @west),
      format("%.4f", @north),
      format("%.4f", @east)
    ].join(":")
  end

  def validate_bbox!
    raise Error, "south, west, north, east обязательны" unless [@south, @west, @north, @east].all?(&:finite?)
    raise Error, "south должна быть меньше north" unless @south < @north
    raise Error, "west должна быть меньше east" unless @west < @east
  end

  def clamp_bbox_to_max_span!
    lat_span = @north - @south
    lng_span = @east - @west
    return if lat_span <= MAX_BBOX_LAT_SPAN && lng_span <= MAX_BBOX_LNG_SPAN

    lat_mid = (@south + @north) / 2.0
    lng_mid = (@west + @east) / 2.0
    @south = lat_mid - (MAX_BBOX_LAT_SPAN / 2.0)
    @north = lat_mid + (MAX_BBOX_LAT_SPAN / 2.0)
    @west = lng_mid - (MAX_BBOX_LNG_SPAN / 2.0)
    @east = lng_mid + (MAX_BBOX_LNG_SPAN / 2.0)
    Rails.logger.info("[OsmBuildingsService] bbox clamped to #{MAX_BBOX_LAT_SPAN}° span")
  end

  def fetch_buildings_parallel
    result = nil
    errors = []
    mutex = Mutex.new

    threads = OVERPASS_ENDPOINTS.map do |endpoint|
      Thread.new do
        next if mutex.synchronize { result }

        buildings = fetch_from_endpoint(endpoint)
        mutex.synchronize { result ||= buildings }
      rescue StandardError => e
        mutex.synchronize { errors << "#{endpoint}: #{e.message}" }
        Rails.logger.warn("[OsmBuildingsService] #{endpoint}: #{e.message}")
      end
    end

    threads.each(&:join)

    return result if result

    Rails.logger.warn("[OsmBuildingsService] Все эндпоинты Overpass недоступны. Ошибки: #{errors.join(', ')}")
    []
  end

  def fetch_from_endpoint(endpoint)
    query = <<~QL.squish
      [out:json][timeout:#{OVERPASS_QUERY_TIMEOUT}];
      (
        way["building"](#{@south},#{@west},#{@north},#{@east});
      );
      out geom qt;
    QL

    conn = Faraday.new(url: endpoint) do |faraday|
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = READ_TIMEOUT
      faraday.options.open_timeout = OPEN_TIMEOUT
    end

    response = conn.post do |req|
      req.headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
      req.body = "data=#{URI.encode_www_form_component(query)}"
    end

    unless response.status.in?(200..299)
      raise Error, "Overpass HTTP #{response.status}"
    end

    payload = JSON.parse(response.body)
    if payload["remark"].present? || payload["error"].present?
      raise Error, payload["remark"].presence || payload["error"].presence || "Overpass error"
    end

    parse_buildings(payload)
  rescue JSON::ParserError
    raise Error, "Некорректный ответ Overpass"
  rescue Faraday::TimeoutError, Faraday::ConnectionFailed => e
    raise Error, "Сетевая ошибка: #{e.message}"
  end

  def parse_buildings(payload)
    elements = Array(payload["elements"])
    polygons = []

    elements.each do |el|
      next unless el["type"] == "way" && Array(el["geometry"]).length >= 4

      ring = el["geometry"].filter_map do |pt|
        lat = pt["lat"]&.to_f
        lon = pt["lon"]&.to_f
        next unless lat.finite? && lon.finite?

        [lat, lon]
      end
      next if ring.length < 4

      first = ring.first
      last = ring.last
      ring << first.dup unless first[0] == last[0] && first[1] == last[1]
      next if ring.length < 4

      bbox = ring_bbox(ring)
      next unless bbox
      next if bbox_area_sq_m(bbox) > MAX_BUILDING_FOOTPRINT_AREA_M2

      polygons << { ring: ring, bbox: bbox }
    end

    polygons
  end

  def ring_bbox(ring)
    min_lat = ring.map { |p| p[0] }.min
    max_lat = ring.map { |p| p[0] }.max
    min_lng = ring.map { |p| p[1] }.min
    max_lng = ring.map { |p| p[1] }.max
    return nil unless [min_lat, max_lat, min_lng, max_lng].all?(&:finite?)

    { south: min_lat, west: min_lng, north: max_lat, east: max_lng }
  end

  def bbox_area_sq_m(bbox)
    lat_mid = (bbox[:south] + bbox[:north]) / 2.0
    height_m = (bbox[:north] - bbox[:south]).abs * 111_320
    width_m = (bbox[:east] - bbox[:west]).abs * 111_320 * Math.cos(lat_mid * Math::PI / 180)
    height_m * width_m
  end
end
