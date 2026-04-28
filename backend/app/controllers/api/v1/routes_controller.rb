module Api
  module V1
    class RoutesController < BaseController
      before_action :set_route, only: [:show]

      # GET /api/v1/routes
      # Параметры: mission_id — маршрут только для одной миссии (отсортирован по sequence_number)
      def index
        routes = params[:mission_id].present? ? Route.for_mission(params[:mission_id]) : Route.all.ordered
        render json: routes
      end
      
      # Показать маршрут GET /api/v1/routes/:id
      def show
        render json: @route
      end
      
      # Создать маршрут POST /api/v1/routes
      def create
        @route = Route.new(route_params)
        if @route.save
          render json: @route, status: :created
        else
          render_errors(@route.errors.full_messages, status: :unprocessable_entity)
        end
      end

      private

      # Поиск маршрута в базе данных
      def set_route
        @route = Route.find(params[:id])
      end
        
      # Параметры маршрута
      def route_params
        params.require(:route).permit(:mission_id, :latitude, :longitude, :altitude, :speed, :sequence_number, :max_altitude)
      end
    end
  end
end