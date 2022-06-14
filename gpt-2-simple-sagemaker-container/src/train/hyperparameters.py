import json
from os import path

from sagemaker import SAGEMAKER_HYPERPARAMETERS_PATH, \
    SAGEMAKER_GPT_2_MODEL_PATH, \
    SAGEMAKER_TRAINING_DATA_PATH, SAGEMAKER_SAMPLE_PATH, \
    SAGEMAKER_MODEL_OUTPUT_PATH

with open(SAGEMAKER_HYPERPARAMETERS_PATH, 'r') as file:
    file_json_content = json.load(file)
    print(file_json_content)
    file.close()


def get_hyperparameters():
    return file_json_content


def get_gpt2_model_path():
    model_path = SAGEMAKER_GPT_2_MODEL_PATH
    if path.exists(model_path):
        return SAGEMAKER_GPT_2_MODEL_PATH
    else:
        raise Exception(f'Directory does not exist: ${model_path}')


def get_steps():
    return get_hyperparameters()['steps']


def get_input_file_path():
    candidate = SAGEMAKER_TRAINING_DATA_PATH
    if path.exists(candidate):
        return candidate
    else:
        raise Exception(f'Path does not exist: ${candidate}')


def get_is_multi_gpu():
    return bool(get_hyperparameters()['is_multi_gpu'])


def get_batch_size():
    return int(get_hyperparameters()['batch_size'])


def get_learning_rate():
    return float(get_hyperparameters()['learning_rate'])


def get_accumulate_gradients():
    return int(get_hyperparameters()['accumulate_gradients'])


def get_sample_interval():
    return int(get_hyperparameters()['sample_interval'])


def get_sample_length():
    return int(get_hyperparameters()['sample_length'])


def get_sample_count():
    return int(get_hyperparameters()['sample_count'])


def get_save_interval():
    return int(get_hyperparameters()['save_interval'])


def get_combine_input_size():
    return int(get_hyperparameters()['combine_input_size'])


def get_restore_from():
    return get_hyperparameters()['restore_from']


def get_run_name():
    return get_hyperparameters()['run_name']


def get_max_checkpoints():
    return int(get_hyperparameters()['max_checkpoints'])


def get_should_use_memory_saving_gradients():
    return bool(get_hyperparameters()['should_use_memory_saving_gradients'])


def get_should_only_train_transform_layers():
    return bool(get_hyperparameters()['should_only_train_transform_layers'])


def get_optimizer():
    return get_hyperparameters()['optimizer']


def get_should_overwrite():
    return bool(get_hyperparameters()['should_overwrite'])


def get_status_print_interval():
    """
    Controls how often the status (step number, loss) are printed to the console.
    :return: The print interval in steps.
    """
    return int(get_hyperparameters()['print_interval'])


def get_checkpoint_directory():
    """
    Sets where checkpoints should be saved.
    :return: The directory that checkpoints should be saved to.
    """
    return SAGEMAKER_MODEL_OUTPUT_PATH


def get_sample_directory():
    """
    Sets where text samples generated during training should be saved.
    :return: The directory where samples should be saved.
    """
    return SAGEMAKER_SAMPLE_PATH
