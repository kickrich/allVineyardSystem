class Api::DetectionsController < ApplicationController
  skip_before_action :verify_authenticity_token, only: [:create]

  def create
    @video = Video.find(params[:video_id])
    
    detection = @video.create_detection!(
      bushes_count: params[:bushes_count],
      gaps_count: params[:gaps_count],
      row_spacing: params[:row_spacing],
      bush_spacing_avg: params[:bush_spacing_avg],
      result_json: params[:result_json]
    )
    
    @video.update!(status: :done)
    
    render json: { 
      detection_id: detection.id,
      status: @video.status,
      message: "Результаты успешно сохранены"
    }, status: :ok
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def show
    detection = Detection.find(params[:id])
    
    render json: {
      id: detection.id,
      video_id: detection.video_id,
      bushes_count: detection.bushes_count,
      gaps_count: detection.gaps_count,
      row_spacing: detection.row_spacing,
      bush_spacing_avg: detection.bush_spacing_avg,
      result_json: detection.result_json,
      created_at: detection.created_at
    }
  end
end