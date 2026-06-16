module Api
  module V1
    class RouteTemplatesController < BaseController
      before_action :set_route_template, only: %i[show update destroy]

      def index
        render_data(@current_user.route_templates.ordered_recent)
      end

      def show
        render_data(@route_template)
      end

      def create
        route_template = @current_user.route_templates.new(route_template_params)
        if route_template.save
          render_message_data(
            "api.route_templates.created",
            route_template,
            status: :created,
            default_message: "Шаблон маршрута сохранён"
          )
        else
          render_errors(route_template.errors.full_messages, status: :unprocessable_entity)
        end
      end

      def update
        if @route_template.update(route_template_params)
          render_message_data(
            "api.route_templates.updated",
            @route_template,
            status: :ok,
            default_message: "Шаблон маршрута обновлён"
          )
        else
          render_errors(@route_template.errors.full_messages, status: :unprocessable_entity)
        end
      end

      def destroy
        @route_template.destroy
        head :no_content
      end

      private

      def set_route_template
        @route_template = @current_user.route_templates.find(params[:id])
      end

      def route_template_params
        t = params.require(:route_template)
        permitted = t.permit(:name, :zone_id)

        normalized_path = normalize_template_path_param(t[:path])
        permitted[:path] = normalized_path unless normalized_path.nil?

        normalized_shift_segment_indices = normalize_shift_segment_indices_param(t[:shift_segment_indices])
        permitted[:shift_segment_indices] = normalized_shift_segment_indices unless normalized_shift_segment_indices.nil?

        permitted
      end

      def normalize_template_path_param(raw)
        parsed =
          case raw
          when String
            parse_json_array(raw)
          when ActionController::Parameters
            raw.to_unsafe_h
          else
            raw
          end

        points =
          case parsed
          when Array
            parsed
          when Hash
            parsed
              .sort_by { |key, _| sortable_param_index(key) }
              .map { |_, value| value }
          else
            return nil
          end

        normalized = points.map { |point| normalize_point(point) }.compact
        normalized
      end

      def normalize_point(point)
        lat, lng =
          case point
          when Array
            [point[0], point[1]]
          when ActionController::Parameters
            extract_point_coords(point.to_unsafe_h)
          when Hash
            extract_point_coords(point)
          else
            return nil
          end

        lat = to_float(lat)
        lng = to_float(lng)
        return nil if lat.nil? || lng.nil?

        [lat, lng]
      end

      def normalize_shift_segment_indices_param(raw)
        parsed =
          case raw
          when String
            parse_json_array(raw)
          when Array
            raw
          else
            nil
          end
        return nil unless parsed.is_a?(Array)

        parsed
          .map { |value| Integer(value, exception: false) }
          .compact
          .select { |index| index >= 0 }
          .uniq
          .sort
      end

      def parse_json_array(raw)
        text = raw.to_s.strip
        return nil if text.empty?

        parsed = JSON.parse(text)
        parsed.is_a?(Array) ? parsed : nil
      rescue JSON::ParserError
        nil
      end

      def to_float(value)
        Float(value)
      rescue ArgumentError, TypeError
        nil
      end

      def sortable_param_index(key)
        str = key.to_s
        return str.to_i if str.match?(/\A\d+\z/)

        str
      end

      def extract_point_coords(hash)
        h = hash.transform_keys(&:to_s)
        return [h["lat"], h["lng"]] if h.key?("lat") || h.key?("lng")
        return [h["0"], h["1"]] if h.key?("0") || h.key?("1")

        values = h.values
        [values[0], values[1]]
      end
    end
  end
end
