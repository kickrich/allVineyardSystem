module Api
  module V1
    class MissionsController < BaseController
      before_action :set_mission, only: %i[show update destroy start complete ai_result]

      # GET /api/v1/missions
      # Параметры: status, drone_id, zone_id, active=1 (только planned/approved/in_progress)
      def index
        missions = Mission.all
        missions = missions.by_status(params[:status]) if params[:status].present?
        missions = missions.for_drone(params[:drone_id]) if params[:drone_id].present?
        missions = missions.where(zone_id: params[:zone_id]) if params[:zone_id].present?
        missions = missions.active if truthy_param?(params[:active])
        render json: missions.includes(:routes).map { |mission| mission.as_json(include: :routes) }
      end

      # Показать миссию GET /api/v1/missions/:id
      def show
        render json: @mission.as_json(include: :routes)
      end

      # Создание миссии POST /api/v1/missions
      def create
        @mission = Mission.new(mission_params)
        @mission.status = Mission.statuses.fetch(:planned)
        if @mission.save
          render_message_data("api.missions.created", @mission, status: :created, default_message: "Миссия создана")
        else
          render_errors(@mission.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Обновление миссии PUT /api/v1/missions/:id
      def update
        if @mission.update(mission_params)
          render json: @mission
        else
          render_errors(@mission.errors.full_messages, status: :unprocessable_entity)
        end
      end
      
      # Удаление миссии DELETE /api/v1/missions/:id
      def destroy
        @mission.destroy
        head :no_content
      end
      
      # Запуск миссии POST /api/v1/missions/:id/start
      def start
        @mission.start!
        render json: @mission
      rescue StandardError => e
        render_errors(e.message, status: :unprocessable_entity)
      end

      # Завершение миссии POST /api/v1/missions/:id/complete
      def complete
        @mission.complete!
        render json: @mission
      rescue StandardError => e
        render_errors(e.message, status: :unprocessable_entity)
      end

      # Получение AI-результата миссии GET /api/v1/missions/:id/ai_result
      def ai_result
        unless @mission.completed?
          render_data(
            {
              mission_id: @mission.id,
              status: "pending",
              available: false,
              ai_result: nil
            }
          )
          return
        end

        result = @mission.ai_result
        if result.nil?
          render_data(
            {
              mission_id: @mission.id,
              status: "pending",
              available: false,
              ai_result: nil
            }
          )
          return
        end

        render_data(
          {
            mission_id: @mission.id,
            status: "ready",
            available: true,
            ai_result: ai_result_payload(result)
          }
        )
      end

      # DELETE /api/v1/missions/:id/ai_result
      def destroy_ai_result
        mission = @current_user.missions.find(params[:id])
        result = mission.ai_result
        if result.nil?
          render_errors("AI-результат для миссии не найден", status: :not_found)
          return
        end

        result.destroy!
        render_data({ mission_id: mission.id, deleted: true })
      end

      # DELETE /api/v1/missions/ai_results
      def destroy_all_ai_results
        mission_ids = @current_user.missions.select(:id)
        deleted_count = AiResult.where(mission_id: mission_ids).delete_all
        render_data({ deleted_count: deleted_count })
      end

      private

      # Поиск миссии в базе данных
      def set_mission
        @mission = Mission.find(params[:id])
      end
            
      # Параметры миссии
      def mission_params
        params.require(:mission).permit(:user_id, :zone_id, :drone_id, :status, :mission_type)
      end

      def ai_result_payload(result)
        attrs = result.attributes
        bushes_positions = attrs.dig("result_json", "bushes_positions")
        gaps_positions = attrs.dig("result_json", "gaps_positions")
        row_sequences = attrs.dig("result_json", "row_sequences")
        bushes_count = attrs["bushes_count"] || Array(bushes_positions).size
        gaps_count = attrs["gaps_count"] || attrs.dig("result_json", "gaps_count") || Array(gaps_positions).size
        rows_count = attrs["rows_count"] || attrs.dig("result_json", "shards_count")

        {
          id: result.id,
          mission_id: result.mission_id,
          bushes_count: bushes_count.to_i,
          gaps_count: gaps_count.to_i,
          rows_count: rows_count.to_i,
          bushes_positions: Array(bushes_positions),
          gaps_positions: Array(gaps_positions),
          row_sequences: Array(row_sequences),
          processing_progress: attrs.dig("result_json", "processing_progress"),
          shards_count: attrs.dig("result_json", "shards_count"),
          processed_shards: attrs.dig("result_json", "processed_shards"),
          created_at: result.created_at,
          updated_at: result.updated_at
        }
      end
    end
  end
end