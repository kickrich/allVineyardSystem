module Api
  module V1
    class VineyardAppController < BaseController
      skip_before_action :authenticate_request!, only: [:results]

      # POST /api/v1/vineyard_app/results
      # Получение результатов анализа от VineyardApp
      # Параметры: mission_id, callback_token, statistics
      def results
        mission = find_mission
        return unless mission

        unless valid_callback_token?(mission)
          render_errors("Неверный токен аутентификации", status: :unauthorized)
          return
        end

        # Сохраняем результаты AI анализа
        ai_result = mission.ai_result || mission.build_ai_result
        stats_param = params[:statistics]
        stats =
          if stats_param.respond_to?(:to_unsafe_h)
            stats_param.to_unsafe_h.with_indifferent_access
          else
            (stats_param || {}).to_h.with_indifferent_access
          end
        rows_count = params[:rows_count].presence || params[:shards_count].presence || stats[:rows_count]
        processed_shards = params[:processed_shards].presence || stats[:processed_shards]
        shards_count = params[:shards_count].presence || stats[:shards_count]

        ai_result.assign_attributes(
          bushes_count: stats[:total_bushes].to_i,
          avg_distance_between_bushes: stats[:avg_bush_spacing].to_f,
          rows_count: rows_count.to_i,
          result_json: {
            gaps_count: stats[:total_gaps].to_i,
            bushes_positions: stats[:bushes_positions] || [],
            gaps_positions: stats[:gaps_positions] || [],
            processing_progress: params[:processing_progress],
            shards_count: shards_count,
            processed_shards: processed_shards
          }
        )

        if ai_result.save
          # Отправляем результаты обратно во внешний сервис если нужно
          mission.send_results_to_vineyard_app!(ai_result_payload(ai_result))

          render_data({
            success: true,
            message: "Результаты сохранены",
            ai_result_id: ai_result.id
          })
        else
          render_errors(ai_result.errors.full_messages, status: :unprocessable_entity)
        end
      end

      private

      def find_mission
        mission = Mission.find_by(id: params[:mission_id])
        if mission.nil?
          render_errors("Миссия не найдена", status: :not_found)
          return nil
        end
        mission
      end

      def valid_callback_token?(mission)
        token = request.headers['Authorization']&.gsub('Bearer ', '')
        token.present? && ActiveSupport::SecurityUtils.secure_compare(
          token,
          mission.vineyard_app_callback_token
        )
      end

      def ai_result_payload(ai_result)
        {
          ai_result_id: ai_result.id,
          mission_id: ai_result.mission_id,
          bushes_count: ai_result.bushes_count,
          gaps_count: ai_result.result_json&.dig("gaps_count").to_i,
          avg_bush_spacing: ai_result.avg_distance_between_bushes,
          created_at: ai_result.created_at,
          updated_at: ai_result.updated_at
        }
      end
    end
  end
end
