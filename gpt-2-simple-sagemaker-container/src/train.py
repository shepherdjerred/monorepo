import gpt_2_simple as gpt2
from train import hyperparameters

input_file = hyperparameters.get_input_file_path()
model_dir = hyperparameters.get_gpt2_model_path()
steps = hyperparameters.get_steps()
is_multi_gpu = hyperparameters.get_is_multi_gpu()
batch_size = hyperparameters.get_batch_size()
learning_rate = hyperparameters.get_learning_rate()
accumulate_gradients = hyperparameters.get_accumulate_gradients()
sample_interval = hyperparameters.get_sample_interval()
sample_length = hyperparameters.get_sample_length()
sample_number = hyperparameters.get_sample_count()
save_interval = hyperparameters.get_save_interval()
print_interval = hyperparameters.get_status_print_interval()
checkpoint_directory = hyperparameters.get_checkpoint_directory()
combine = hyperparameters.get_combine_input_size()
restore_from = hyperparameters.get_restore_from()
run_name = hyperparameters.get_run_name()
max_checkpoints = hyperparameters.get_max_checkpoints()
should_use_memory_saving_gradients = hyperparameters.get_should_use_memory_saving_gradients()
should_only_train_transform_layers = hyperparameters.get_should_only_train_transform_layers()
optimizer = hyperparameters.get_optimizer()
should_overwrite = hyperparameters.get_should_overwrite()

session = gpt2.start_tf_sess()

print('beginning training')

gpt2.finetune(sess=session,
              dataset=input_file,
              steps=steps,
              model_name='',
              model_dir=model_dir,
              combine=combine,
              batch_size=batch_size,
              learning_rate=learning_rate,
              accumulate_gradients=accumulate_gradients,
              restore_from=restore_from,
              run_name=run_name,
              checkpoint_dir=checkpoint_directory,
              sample_every=sample_interval,
              sample_length=sample_length,
              sample_num=sample_number,
              multi_gpu=is_multi_gpu,
              save_every=save_interval,
              print_every=print_interval,
              max_checkpoints=max_checkpoints,
              use_memory_saving_gradients=should_use_memory_saving_gradients,
              only_train_transformer_layers=should_only_train_transform_layers,
              optimizer=optimizer,
              overwrite=should_overwrite)

print('training complete')
