# app/controllers/api/v1/telemetries_controller.rb

module Api
  module V1
    class TelemetriesController < BaseController
      before_action :set_telemetry, only: [:show, :update, :destroy]

      # GET /api/v1/telemetries
      # Параметры: mission_id — телеметрия по миссии; from, to — фильтр по recorded_at (ISO8601)
      def index
        telemetries = params[:mission_id].present? ? Telemetry.for_mission(params[:mission_id]) : Telemetry.all.ordered
        if params[:from].present?
          t_from = parse_time_param(params[:from])
          telemetries = telemetries.where("recorded_at >= ?", t_from) if t_from
        end
        if params[:to].present?
          t_to = parse_time_param(params[:to])
          telemetries = telemetries.where("recorded_at <= ?", t_to) if t_to
        end
        render json: telemetries
      end
      
      # Показать телеметрию GET /api/v1/telemetries/:id
      def show
        render json: @telemetry
      end

      # Создание телеметрии POST /api/v1/telemetries
      def create
        @telemetry = Telemetry.new(telemetry_params)
        if @telemetry.save
          @telemetry.mission.register_telemetry!(at: @telemetry.recorded_at)
          render json: @telemetry, status: :created
        else
          render_errors(@telemetry.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Обновление телеметрии PUT /api/v1/telemetries/:id
      def update
        if @telemetry.update(telemetry_params)
          render json: @telemetry
        else
          render_errors(@telemetry.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Удаление телеметрии DELETE /api/v1/telemetries/:id
      def destroy
        @telemetry.destroy
        head :no_content
      end

      private

      # Поиск телеметрии в базе данных
      def set_telemetry
        @telemetry = Telemetry.find(params[:id])
      end

      # Параметры телеметрии
      def telemetry_params
        params.require(:telemetry).permit(:mission_id, :recorded_at, :latitude, :longitude, :altitude, :speed, :battery)
      end
      
      # Парсинг времени
      def parse_time_param(value)
        Time.zone.parse(value)
      rescue ArgumentError, TypeError
        nil
      end
    end
  end
end
