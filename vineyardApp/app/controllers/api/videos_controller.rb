class Api::VideosController < ApplicationController
  protect_from_forgery with: :null_session, only: [:create, :upload_shard]

  def create
    video = Video.new(
      name: params[:name] || "Видео #{Time.current.strftime('%Y-%m-%d %H:%M')}",
      status: :uploading
    )

    if video.save
      render json: {
        id: video.id,
        name: video.name,
        status: video.status,
        message: "Видео создано, можно загружать шарды"
      }, status: :created
    else
      render json: { error: video.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def upload_shard
    video = Video.find(params[:id])
    shard_index = params[:shard_index].to_i

    unless params[:video]
      return render json: { error: "Файл не выбран" }, status: :unprocessable_entity
    end

    if shard_index < 1
      return render json: { error: "Некорректный номер ряда (минимум 1)" }, status: :unprocessable_entity
    end

    if video.video_shards.exists?(shard_index: shard_index)
      return render json: { error: "Shard #{shard_index} уже загружен" }, status: :conflict
    end

    shard = video.video_shards.new(
      shard_index: shard_index,
      original_filename: params[:video].original_filename,
      status: :pending
    )

    if shard.save
      shard.video_file.attach(params[:video])

      unless shard.video_file.attached?
        shard.destroy
        return render json: { error: "Не удалось прикрепить файл" }, status: :unprocessable_entity
      end

      job = ProcessVideoShardJob.perform_later(shard.id)
      # Не запускаем валидации повторно: они тяжелые (FFMPEG) и могут падать,
      # а job_id — техническое поле.
      shard.update_column(:job_id, job.job_id)

      video.recalculate_status!

      render json: {
        id: shard.id,
        video_id: video.id,
        shard_index: shard_index,
        status: shard.status,
        message: "Shard #{shard_index} загружен и поставлен в очередь на обработку"
      }, status: :created
    else
      render json: { error: shard.errors.full_messages }, status: :unprocessable_entity
    end
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages }, status: :unprocessable_entity
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def show
    video = Video.find(params[:id])
    
    render json: {
      id: video.id,
      name: video.name,
      status: video.status,
      created_at: video.created_at,
      updated_at: video.updated_at,
      shards_count: video.video_shards.count,
      processed_shards: video.video_shards.where(status: :completed).count,
      progress: video.processing_progress,
      statistics: {
        total_bushes: video.total_bushes_count,
        total_gaps: video.total_gaps_count,
        avg_bush_spacing: video.avg_bush_spacing,
        bushes_positions: video.all_bushes_positions,
        gaps_positions: video.all_gaps_positions
      },
      shards: video.video_shards.order(:shard_index).map do |shard|
        {
          id: shard.id,
          index: shard.shard_index,
          status: shard.status,
          filename: shard.original_filename,
          bushes_count: shard.bushes_count,
          gaps_count: shard.gaps_count,
          bush_spacing_avg: shard.bush_spacing_avg,
          processed_at: shard.updated_at
        }
      end
    }
  end

  def index
    videos = Video.order(created_at: :desc).limit(100)
    
    render json: videos.map { |v|
      {
        id: v.id,
        name: v.name,
        status: v.status,
        created_at: v.created_at,
        shards_count: v.video_shards.count,
        processed_shards: v.video_shards.where(status: :completed).count,
        progress: v.processing_progress
      }
    }
  end

  def destroy
    video = Video.find(params[:id])
    
    video.destroy!
    
    render json: { message: "Видео удалено" }, status: :ok
  end

  def shard_status
    video = Video.find(params[:id])
    shard = video.video_shards.find_by(shard_index: params[:shard_index])
    
    if shard.nil?
      return render json: { error: "Shard не найден" }, status: :not_found
    end
    
    render json: {
      shard_id: shard.id,
      shard_index: shard.shard_index,
      status: shard.status,
      bushes_count: shard.bushes_count,
      gaps_count: shard.gaps_count,
      bush_spacing_avg: shard.bush_spacing_avg,
      progress: case shard.status
                when 'pending' then 0
                when 'processing' then 50
                when 'completed' then 100
                when 'error' then 0
                else 0
                end,
      step: case shard.status
            when 'pending' then "Ожидает обработки"
            when 'processing' then "Обработка..."
            when 'completed' then "Завершено"
            when 'error' then "Ошибка"
            else "Неизвестно"
            end,
      message: case shard.status
              when 'pending' then "Видео в очереди"
              when 'processing' then "CV сервис анализирует видео"
              when 'completed' then "Обработка завершена успешно"
              when 'error' then "Произошла ошибка при обработке"
              else "Статус неизвестен"
              end
    }
  end
end