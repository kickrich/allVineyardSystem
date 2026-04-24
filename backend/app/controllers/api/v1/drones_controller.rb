module Api
  module V1
    class DronesController < BaseController
      # Действия для дрона
      before_action :set_drone, only: %i[show update destroy]

      # Список дронов GET /api/v1/drones
      def index
        drones = Drone.all
        drones = drones.by_status(params[:status]) if params[:status].present?
        drones = drones.available if truthy_param?(params[:available])
        render json: drones
      end

      # Показать дрон GET /api/v1/drones/:id
      def show
        render json: @drone
      end
      
      # Создание дрона POST /api/v1/drones
      def create
        drone = Drone.new(drone_params)

        if drone.save
          render json: drone, status: :created
        else
          render_errors(drone.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Обновление дрона PUT /api/v1/drones/:id
      def update
        if @drone.update(drone_params)
          render json: @drone
        else
          render_errors(@drone.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # DELETE /api/v1/drones/:id
      def destroy
        unless @drone.offline?
          render_errors(
            I18n.t(
              "api.drones.errors.delete_only_offline",
              default: "Нельзя удалить дрон, пока он в сети или на задании. Сначала переведите его в offline."
            ),
            status: :forbidden
          )
          return
        end
        if @drone.destroy
          head :no_content
        else
          render_errors(@drone.errors.full_messages, status: :unprocessable_entity)
        end
      end

      private
      
      # Поиск дрона в базе данных
      def set_drone
        @drone = Drone.find(params[:id])
      end

      # Параметры дрона
      def drone_params
        params.require(:drone).permit(:name, :model, :status, :battery)
      end
    end
  end
end
