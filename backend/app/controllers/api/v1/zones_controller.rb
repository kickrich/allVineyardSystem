# app/controllers/api/v1/zones_controller.rb

module Api
  module V1
    class ZonesController < BaseController
      before_action :set_zone, only: [:show, :update, :destroy]

      # GET /api/v1/zones — список по имени
      def index
        render_data(Zone.ordered_by_name)
      end

      def show
        render_data(@zone)
      end
        
      def create
        @zone = Zone.new(zone_params)
        return unless assign_boundary_from_kml!(@zone)

        if @zone.save
          render_message_data("api.zones.created", @zone, status: :created, default_message: "Зона создана")
        else
          render_errors(@zone.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Обновление зоны PUT /api/v1/zones/:id
      def update
        return unless assign_boundary_from_kml!(@zone)

        if @zone.update(zone_params)
          render_message_data("api.zones.updated", @zone, status: :ok, default_message: "Зона обновлена")
        else
          render_errors(@zone.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Удаление зоны DELETE /api/v1/zones/:id
      def destroy
        @zone.destroy
        head :no_content
      end

      private

      # Поиск зоны в базе данных
      def set_zone
        @zone = Zone.find(params[:id])
      end
      
      # Параметры зоны (boundary — массив пар [lng, lat]; permit(boundary: []) их режет)
      def zone_params
        z = params.require(:zone)
        permitted = z.permit(:name, :description, :kml_file)
        raw_boundary = z[:boundary]
        permitted[:boundary] = raw_boundary if raw_boundary.is_a?(Array)
        permitted
      end

      # Присвоение границы зоны из KML файла
      def assign_boundary_from_kml!(zone)
        uploaded_kml = params.dig(:zone, :kml_file)
        return true if uploaded_kml.blank?

        zone.boundary = ::KmlPolygonParser.call(uploaded_kml.tempfile)
        true
      rescue ::KmlPolygonParser::ParseError => e
        render_errors(
          I18n.t("api.zones.errors.kml_parse", details: e.message, default: "Ошибка KML: %{details}"),
          status: :unprocessable_entity
        )
        false
      end
    end
  end
end
