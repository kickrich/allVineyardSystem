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

        unless mission.completed?
          Rails.logger.warn("[vineyard_app/results] mission_id=#{mission.id} status=#{mission.status} (saving early to avoid result loss)")
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
        top_level = params.respond_to?(:to_unsafe_h) ? params.to_unsafe_h.with_indifferent_access : {}.with_indifferent_access
        rows_count = params[:rows_count].presence || params[:shards_count].presence || stats[:rows_count]
        processed_shards = params[:processed_shards].presence || stats[:processed_shards]
        shards_count = params[:shards_count].presence || stats[:shards_count]
        bushes_positions = extract_positions(stats, top_level, :bushes_positions, :bushesPositions, :bushes_points, :bushesPoints)
        gaps_positions = extract_positions(stats, top_level, :gaps_positions, :gapsPositions, :gaps_points, :gapsPoints)

        ai_result.assign_attributes(
          bushes_count: stats[:total_bushes].to_i,
          avg_distance_between_bushes: stats[:avg_bush_spacing].to_f,
          rows_count: rows_count.to_i,
          result_json: {
            gaps_count: stats[:total_gaps].to_i,
            bushes_positions: bushes_positions,
            gaps_positions: gaps_positions,
            processing_progress: params[:processing_progress],
            shards_count: shards_count,
            processed_shards: processed_shards
          }
        )

        if ai_result.save
          # Опциональный callback обратно в VineyardApp оставляем отключенным по умолчанию:
          # он не нужен для пользовательского потока "VineyardApp -> backend -> frontend".
          if ActiveModel::Type::Boolean.new.cast(ENV['FORWARD_RESULTS_BACK_TO_VINEYARD_APP'])
            mission.send_results_to_vineyard_app!(ai_result_payload(ai_result))
          end

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

      def extract_positions(stats, top_level, *keys)
        raw =
          keys.lazy.map { |key| stats[key] }.find(&:present?) ||
          keys.lazy.map { |key| top_level[key] }.find(&:present?)
        arr =
          case raw
          when Array
            raw
          when ActionController::Parameters
            raw.to_unsafe_h.values
          when Hash
            raw.values
          else
            []
          end
        arr.filter_map { |item| normalize_position_item(item) }
      end

      def normalize_position_item(item)
        case item
        when Array
          return nil if item.length < 2
          lng = to_float(item[0])
          lat = to_float(item[1])
          return nil if lng.nil? || lat.nil?
          [lng, lat]
        when ActionController::Parameters
          normalize_position_hash(item.to_unsafe_h)
        when Hash
          normalize_position_hash(item)
        else
          nil
        end
      end

      def normalize_position_hash(hash)
        h = hash.with_indifferent_access
        lng = to_float(h[:lng] || h[:lon] || h[:longitude] || h[:x])
        lat = to_float(h[:lat] || h[:latitude] || h[:y])
        return nil if lng.nil? || lat.nil?
        [lng, lat]
      end

      def to_float(value)
        Float(value)
      rescue ArgumentError, TypeError
        nil
      end
    end
  end
end
