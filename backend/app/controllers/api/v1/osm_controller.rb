# frozen_string_literal: true

module Api
  module V1
    class OsmController < ApplicationController
      # GET /api/v1/osm/buildings?south=&west=&north=&east=
      def buildings
        buildings = fetch_buildings_with_fallback

        render json: {
          buildings: buildings,
          degraded: buildings.empty?
        }, status: :ok
      rescue StandardError => e
        Rails.logger.error("[OsmController#buildings] #{e.message}")
        render json: { buildings: [], degraded: true, errors: [e.message] }, status: :ok
      end

      private

      def fetch_buildings_with_fallback
        # Сначала пробуем Overpass
        begin
          result = OsmBuildingsService.new(
            south: params[:south],
            west: params[:west],
            north: params[:north],
            east: params[:east]
          ).call

          return result if result.present?
        rescue StandardError => e
          Rails.logger.warn("[OsmController] Overpass не удался: #{e.message}")
        end

        # Если Overpass не дал результатов — пробуем Яндекс
        begin
          result = YandexBuildingsService.new(
            south: params[:south],
            west: params[:west],
            north: params[:north],
            east: params[:east]
          ).call

          return result if result.present?
        rescue StandardError => e
          Rails.logger.warn("[OsmController] Яндекс не удался: #{e.message}")
        end

        []
      end
    end
  end
end
