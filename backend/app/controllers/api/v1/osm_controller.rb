# frozen_string_literal: true

module Api
  module V1
    class OsmController < ApplicationController
      # GET /api/v1/osm/buildings?south=&west=&north=&east=
      def buildings
        buildings = OsmBuildingsService.new(
          south: params[:south],
          west: params[:west],
          north: params[:north],
          east: params[:east]
        ).call

        render json: {
          buildings: buildings,
          degraded: buildings.empty?
        }, status: :ok
      rescue OsmBuildingsService::Error => e
        Rails.logger.warn("[OsmController#buildings] #{e.message}")
        render json: { buildings: [], degraded: true, errors: [e.message] }, status: :ok
      end
    end
  end
end
