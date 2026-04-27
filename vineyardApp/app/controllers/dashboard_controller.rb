class DashboardController < ApplicationController
  include Pagy::Method

  def index
    @pagy, @videos = pagy(:offset, Video.order(created_at: :desc), limit: 10)
  end

  def show
    @video = Video.find(params[:id])
    @shards_pagy, @shards = pagy(:offset, @video.video_shards.order(:shard_index), limit: 5)
  end

  def destroy
    video = Video.find(params[:id])
    video.destroy!
    
    respond_to do |format|
      format.html { redirect_to root_path, notice: "Видео успешно удалено" }
      format.json { render json: { success: true } }
    end
  end

  def destroy_shard
    shard = VideoShard.find(params[:shard_id])
    video = shard.video
    
    shard.destroy!
    video.recalculate_status!
    
    respond_to do |format|
      format.html { redirect_to video_path(video.id), notice: "Ряд #{shard.shard_index} успешно удален" }
      format.json do
        render json: {
          success: true,
          statistics: {
            total_bushes: video.total_bushes_count,
            total_gaps: video.total_gaps_count,
            shards_count: video.video_shards.count,
            processed_shards: video.video_shards.where(status: :completed).count,
            progress: video.processing_progress
          }
        }
      end
    end
  end
end